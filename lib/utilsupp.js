/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 utilsupp.js - a set of functions to deal with AlpineBits Supplement elements (stored as xm2js - JS objects)

 author: chris@1006.org

 */

'use strict';


exports.get_unique_codes = get_unique_codes;
exports.get_merged_supp_by_code = get_merged_supp_by_code;

var utildate = require('./utildate');


/**
 *  get a list of unique Supplement -> InvCode attributes in the given RatePlan element
 *
 * @param   {Object}    rpel - a RatePlan element
 *
 * @returns {[String]}  an array of InvCode attribute values
 * @throws  {String}    in case of validation errors
 */
function get_unique_codes(rpel) {

    var i, c;

    var codes = {};
    var supp;

    if (rpel.Supplements) {
        if (rpel.Supplements.length > 1) {
            throw 'invalid RatePlan: more than one Supplements elements';
        }
        supp = rpel.Supplements[0].Supplement;
    }
    if (supp) {
        for (i = 0; i < supp.length; i++) {
            if (supp[i].$ === undefined) {
                throw 'invalid Supplement: Supplement element has no attributes';
            }
            c = supp[i].$.InvCode;
            if (!c) {
                throw 'invalid Supplement: missing InvCode attribute'
            }
            codes[c] = 1;
        }
    }

    return Object.keys(codes);

}


/**
 *  consider all Supplement elements matching the given InvCode attribute under the given RatePlan element:
 *  parse and merge the static ONE with the date dependent ONES into pre-processed JS objects
 *
 * @param   {Object}    rpel - a RatePlan element
 * @param   {String}    sic  - InvCode to look for
 *
 * @returns {Object}    the pre-processed JS object with fields: ctc, mandatory and dyn[]
 * @throws  {String}    in case of validation errors
 */
function get_merged_supp_by_code(rpel, sic) {

    var i, j;
    var ret = {dyn: []};

    var ctc, sdate, edate, amt;

    var supps = rpel.Supplements;
    if (!supps) {
        return ret;
    }
    if (supps.length > 1) {
        throw 'invalid RatePlan: more than one Supplements elements';
    }

    var supp = supps[0].Supplement;

    var mnd, pre, pre_dow, pre_room;

    // first pass: find the ONE "static" element (let's use ChargeTypeCode to identify it) and store its data into ret

    for (i = 0; i < supp.length; i++) {

        if (supp[i].$ === undefined || supp[i].$.InvType !== 'EXTRA') {
            throw 'invalid Supplement: missing or invalid InvType attribute';
        }
        if (!supp[i].$.InvCode) {
            throw 'invalid Supplement: missing InvCode attribute';
        }
        if (supp[i].$.InvCode !== sic) {
            continue;
        }
        ctc = supp[i].$.ChargeTypeCode;
        if (!ctc) { // skip dynamic elements
            continue;
        }
        if (supp[i].$.Start !== undefined || supp[i].$.End !== undefined) {
            throw 'invalid static Supplement element: must not contain Start or End attributes';
        }
        if (['1', '12', '18', '19', '20', '21', '24'].indexOf(ctc) === -1) {
            throw 'invalid static Supplement element: invalid ChargeTypeCode';
        }
        if (ret.ctc) {
            throw 'invalid RatePlan: more than one static Supplement element with the same InvCode ("' + sic + '")';
        }
        ret.ctc = ctc;
        if (!supp[i].$.AddToBasicRateIndicator || !supp[i].$.AddToBasicRateIndicator.match(/^(1|true)$/i)) {
            throw 'invalid static Supplement element: invalid or missing AddToBasicRateIndicator attribute';
        }
        mnd = supp[i].$.MandatoryIndicator;
        if (!mnd) {
            throw 'invalid static Supplement element: missing MandatoryIndicator attribute';
        }
        if (mnd.match(/^(1|true)$/i)) {
            ret.mandatory = true;
        } else if (mnd.match(/^(0|false)$/i)) {
            ret.mandatory = false;
        } else {
            throw 'invalid static Supplement element: invalid MandatoryIndicator attribute';
        }

        // "static" PrerequisiteInventory (InvType="ALPINEBITSDOW")

        pre = supp[i].PrerequisiteInventory;
        pre_dow = undefined;
        if (pre === undefined) {
            pre_dow = "1111111";
        } else {
            if (pre.length > 1) {
                throw 'invalid static Supplement element: more than one PrerequisiteInventory';
            }
            pre = pre[0];
            if (pre.$ === undefined || pre.$.InvType !== 'ALPINEBITSDOW') {
                throw 'invalid static Supplement element: PrerequisiteInventory is expected to have an attribute InvType="ALPINEBITSDOW"';
            }
            pre_dow = pre.$.InvCode;
            if (pre_dow === undefined || !pre_dow.match(/^[01]{7}$/)) {
                throw 'invalid static Supplement element: PrerequisiteInventory is expected to have an attribute InvCode containing seven binary digits (0 or 1)';
            }
        }
        ret.pre_dow = pre_dow;

    }

    if (!ret.ctc) {
        throw 'invalid RatePlan: no static Supplement element with InvCode "' + sic + '" found';
    }

    // second pass: find all the "dynamic" Supplement elements and store their data into ret, again let's use
    // the absence of ChargeTypeCode as means to identify an element as "dynamic"

    for (i = 0; i < supp.length; i++) {
        if (supp[i].$.InvCode !== sic) {
            continue;
        }
        ctc = supp[i].$.ChargeTypeCode;
        if (ctc) { // skip static elements
            continue;
        }

        sdate = supp[i].$.Start;
        edate = supp[i].$.End;
        amt = supp[i].$.Amount;

        if (!utildate.is_valid_date(sdate)) {
            throw 'invalid dynamic Supplement element: invalid or missing Start attribute';
        }
        if (!utildate.is_valid_date(edate)) {
            throw 'invalid dynamic Supplement element: invalid or missing End attribute';
        }
        if (utildate.date_diff(sdate, edate) < 0) {
            throw 'invalid dynamic Supplement element: Start > End';
        }
        if (!is_non_negative_float(amt)) {
            throw 'invalid dynamic Supplement element: invalid or missing Amount attribute';
        }

        // "dynamic" PrerequisiteInventory (InvType="ROOMTYPE")

        pre = supp[i].PrerequisiteInventory;
        pre_room = undefined;
        if (pre !== undefined) {
            if (pre.length > 1) {
                throw 'invalid dynamic Supplement element: more than one PrerequisiteInventory';
            }
            pre = pre[0];
            if (pre.$.InvType !== 'ROOMTYPE') {
                throw 'invalid dynamic Supplement element: PrerequisiteInventory is expected to have an attribute InvType="ROOMTYPE"';
            }
            pre_room = pre.$.InvCode;
            if (pre_room === undefined || pre_room === "") {
                throw 'invalid dynamic Supplement element: PrerequisiteInventory is expected to have a non-empty attribute InvCode';
            }
        }
        ret.dyn.push({start: sdate, end: edate, amount: Number(amt), pre_room: pre_room});

    }

    if (ret.dyn.length === 0) {
        throw 'invalid RatePlan: no dynamic Supplement elements with InvCode "' + sic + '" found';
    }

    for (i = 0; i < ret.dyn.length; i++) {
        for (j = 0; j < ret.dyn.length; j++) {
            if (j > i && ret.dyn[i].pre_room === ret.dyn[j].pre_room && utildate.date_interval_overlaps(ret.dyn[i].start, ret.dyn[i].end, ret.dyn[j].start, ret.dyn[j].end)) {
                throw 'invalid dynamic Supplement element: overlay detected for InvCode "' + sic + '"';
            }
        }
    }

    return ret;

}


/* private functions */


function is_non_negative_float(a) {

    var s = String(a);
    if (s.match(/^\d+\.\d+$/) || s.match(/^\d+$/)) {
        return true;
    }
    return false;
}
