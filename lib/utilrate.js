/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 utilrate.js - a set of functions to deal with AlpineBits Rate elements (stored as xm2js - JS objects)

 author: chris@1006.org

 */

'use strict';


exports.get_static_data = get_static_data;
exports.get_unique_codes = get_unique_codes;
exports.find_rates_by_code = find_rates_by_code;
exports.check_rates_overlap = check_rates_overlap;
exports.get_rate = get_rate;

var utildate = require('./utildate');


/**
 *  get an object with the "static" data of the given rate plan
 *
 * @param   {Object}    rpel - a RatePlan element
 *
 * @returns {Object}    an object with the "static" data of this rate plan:
 *                          - UnitMultiplier
 *                          - Type
 * @throws  {String}    in case of validation errors
 */

function get_static_data(rpel) {

    var ret = {};

    var rates = rpel.Rates;
    if (rates === undefined || rates.length !== 1) {
        throw 'invalid RatePlan: need exactly one Rates element';

    }

    var rate = rates[0].Rate;

    if (rate === undefined || rate.length < 1) {
        throw 'invalid RatePlan: need at least one Rate element';
    }

    // the first Rate is the "static" Rate

    rate = rate[0];

    // the "static Rate" must NOT contain any of the attributes:
    // - Start
    // - End
    // - InvTypeCode

    if (rate.$ !== undefined) {
        if (rate.$.InvTypeCode !== undefined || rate.$.Start !== undefined || rate.$.End !== undefined) {
            throw 'invalid RatePlan: the first Rate is supposed to be the "static" Rate, it must not have a InvTypeCode, Start or End attribute';
        }
    }

    // the "static Rate" must contain:
    // - the optional attributes RateTimeUnit ("Day") and UnitMultiplier (defaults to 1)
    // - one mandatory BaseByGuestAmt Element with attribute Type ("7" or "25")

    var rtu;
    var um = 1; // default 1 day

    if (rate.$ !== undefined) {
        rtu = rate.$.RateTimeUnit;
        um = rate.$.UnitMultiplier;
        if ((rtu === undefined && um !== undefined) || (rtu !== undefined && um === undefined)) {
            throw 'invalid "static" Rate: attributes RateTimeUnit and UnitMultiplier: none or both must be given';
        } else if (rtu !== 'Day') {
            throw 'invalid "static" Rate: when given, RateTimeUnit must be "Day"';
        } else if (!is_positive_int(um)) {
            throw 'invalid "static" Rate: when given, UnitMultiplier must be a positive integer';
        } else if (um > 365) {
            throw 'invalid "static" Rate: the given UnitMultiplier is unreasonably large';
        }
    }
    ret.UnitMultiplier = Number(um);

    var bases = rate.BaseByGuestAmts;

    if (bases === undefined || bases.length !== 1) {
        throw 'invalid "static" Rate: need exactly one BaseByGuestAmts element';
    }

    var base = bases[0].BaseByGuestAmt;

    if (base === undefined || base.length !== 1) {
        throw 'invalid "static" Rate: need exactly one BaseByGuestAmt element';
    }

    base = base[0];

    if ( base.$ === undefined || base.$.Type === undefined ) {
        throw 'invalid "static" Rate: mandatory attribute BaseByGuestAmt -> Type is missing';
    }
    var type = base.$.Type;
    if ( type != '7' && type != '25') {
        throw 'invalid "static" Rate: attribute BaseByGuestAmt -> Type must be "7" or "25"';
    }
    ret.Type = String(type);

    return ret;

}


/**
 *  get a list of unique Rate -> InvTypeCode attributes in the given RatePlan element
 *
 * @param   {Object}    rpel - a RatePlan element
 *
 * @returns {[String]}  an array of InvTypeCode attribute values
 * @throws  {String}    in case of validation errors
 */
function get_unique_codes(rpel) {

    var i, c;

    var codes = {};

    var rates = rpel.Rates;
    var rate;

    if (rates) {

        if (rates.length > 1) {
            throw 'invalid RatePlan: more than one Rates elements';
        }

        rate = rates[0].Rate;

        if (rate) {
            // skip the first rate (the "static" one)
            for (i = 1; i < rate.length; i++) {
                if (rate[i].$ === undefined) {
                    throw 'invalid RatePlan: (non-"static") Rate element with no attributes';
                }
                c = rate[i].$.InvTypeCode;
                if (!c) {
                    throw 'invalid RatePlan: (non-"static") Rate element is missing attribute InvTypeCode';
                }
                codes[c] = 1;
            }
        }

    }

    return Object.keys(codes);

}


/**
 *  find all Rate elements matching the given InvTypeCode attribute under the given RatePlan element
 *
 * @param   {Object}    rpel - a RatePlan element
 * @param   {String}    ritc  - InvTypeCode to look for
 *
 * @returns {[Object]}  an array of Rate elements
 * @throws  {String}    in case of validation errors
 */
function find_rates_by_code(rpel, ritc) {

    var ret = [];
    var rates = rpel.Rates;
    var rate;
    var i;

    if (rates) {

        if (rates.length > 1) {
            throw 'invalid RatePlan: more than one Rates elements';
        }
        rate = rates[0].Rate;

        // skip the first rate (the "static" one)
        for (i = 1; i < rate.length; i++) {
            if (rate[i].$ === undefined) {
                throw 'invalid RatePlan: (non-"static") Rate element with no attributes';
            }
            if (rate[i].$.InvTypeCode !== ritc) {
                continue;
            }
            ret.push(rate[i]);
        }

    }

    return ret;

}


/**
 *  detect start/end overlaps in a list of Rate elements
 *
 * @param   {[Object]}  rel_list - a list of Rate elements
 * @param   {Object}    static_data - an object with the "static" data of rate plan (see get_static_data())
 *
 * @returns {Number}    0 (all good)
 * @throws  {String}    in case of overlapping intervals
 */
function check_rates_overlap(rel_list, static_data) {

    var i, j;

    var a = [];
    for (i = 0; i < rel_list.length; i++) {
        a.push(get_rate(rel_list[i], static_data));
    }

    for (i = 0; i < a.length; i++) {
        for (j = 0; j < a.length; j++) {
            if (j > i && utildate.date_interval_overlaps(a[i].start, a[i].end, a[j].start, a[j].end)) {
                throw 'invalid Rate: overlap detected';
            }
        }
    }

    return 0;

}


/**
 *  validate a Rate and extract useful information as flat JS Object
 *
 * @param   {Object}    rel - a Rate element
 * @param   {Object}    static_data - an object with the "static" data of rate plan (see get_static_data())
 *
 * @returns {Object}    the flat JS object with start, end, night_cnt, base_amt, add_amt
 * @throws  {String}    in case of validation errors
 */
function get_rate(rel, static_data) {

    var ret = {};
    var i, a;

    // start/end

    ret.start = rel.$.Start;
    ret.end = rel.$.End;

    if (!utildate.is_valid_date(ret.start)) {
        throw 'invalid Rate: invalid or missing Start attribute';
    }
    if (!utildate.is_valid_date(ret.end)) {
        throw 'invalid Rate: invalid or missing End attribute';
    }
    if (utildate.date_diff(ret.start, ret.end) < 0) {
        throw 'invalid Rate: Start > End';
    }

    // night_cnt

    ret.night_cnt = Number(static_data.UnitMultiplier);

    // base_amt (BaseByGuestAmt elements)

    ret.base_amt = {};

    a = rel.BaseByGuestAmts;

    if (!a) {
        throw 'invalid Rate: missing BaseByGuestAmts';
    }
    if (a.length > 1) {
        throw 'invalid Rate: more than one BaseByGuestAmts elements';
    }

    a = rel.BaseByGuestAmts[0].BaseByGuestAmt;

    if (!a) {
        throw 'invalid Rate: no BaseByGuestAmt found';
    }

    var type = static_data.Type;

    var numog, ageqc, amtat;

    for (i = 0; i < a.length; i++) {

        if (a[i].$ === undefined) {
            throw 'invalid Rate: BaseByGuestAmt has no attributes';
        }

        numog = a[i].$.NumberOfGuests;
        ageqc = a[i].$.AgeQualifyingCode;
        amtat = a[i].$.AmountAfterTax;

        if (!is_positive_int(numog)) {
            throw 'invalid Rate: missing or invalid NumberOfGuests attribute in BaseByGuestAmt';
        }
        if (ageqc !== '10') {
            throw 'invalid Rate: missing or invalid AgeQualifyingCode attribute in BaseByGuestAmt';
        }
        if (!is_non_negative_float(amtat)) {
            throw 'invalid Rate: missing or invalid AmountAfterTax attribute in BaseByGuestAmt';
        }

        // if and only if type == 7 the amtat must be multiplied by numog -> let's do this right away!

        if (type === '7') {
            amtat *= numog;
        }

        // save the info1 in base_amt with numog as the key

        if (ret.base_amt[numog]) {
            throw 'invalid Rate: more than one BaseByGuestAmt have the same value for the NumberOfGuests attribute';
        }

        ret.base_amt[numog] = {amtat: Number(amtat), type: type};

        // save the type also to base_amt_type

        ret.base_amt_type = type;

    }

    // add_amt (AdditionalGuestAmount elements)

    ret.add_amt = [];

    var ten_seen = false;

    a = rel.AdditionalGuestAmounts;

    if (a) {

        if (a.length > 1) {
            throw 'invalid Rate: more than one AdditionalGuestAmounts elements';
        }

        a = a[0].AdditionalGuestAmount;

        if (a) {

            var minage, maxage, agecod, amount;

            for (i = 0; i < a.length; i++) {

                if (a[i].$ === undefined) {
                    throw 'invalid Rate: AdditionalGuestAmount has no attributes';
                }

                minage = a[i].$.MinAge;
                maxage = a[i].$.MaxAge;
                agecod = a[i].$.AgeQualifyingCode;
                amount = a[i].$.Amount;

                if (agecod !== '8' && agecod !== '10') {
                    throw 'invalid Rate: missing or invalid AgeQualifyingCode attribute in AdditionalGuestAmount';
                }
                if (agecod === '10') {
                    if (ten_seen) {
                        throw 'invalid Rate: there can not be more than one AdditionalGuestAmount elements with AgeQualifyingCode = "10"';
                    }
                    ten_seen = true;
                }
                if (!is_non_negative_float(amount)) {
                    throw 'invalid Rate: missing or invalid Amount attribute in AdditionalGuestAmount';
                }
                if (minage && !is_positive_int(minage)) { // OTA requires positive ints, even though it would make sense to allow 0 here...
                    throw 'invalid Rate: missing or invalid MinAge attribute in AdditionalGuestAmount';
                }
                if (maxage && !is_positive_int(maxage)) {
                    throw 'invalid Rate: missing or invalid MaxAge attribute in AdditionalGuestAmount';
                }
                if (agecod === '8' && !minage && !maxage) {
                    throw 'invalid Rate: an AdditionalGuestAmount element has AgeQualifyingCode = "8" with no age brackets';
                }
                if (agecod === '10' && (minage || maxage)) {
                    throw 'invalid Rate: an AdditionalGuestAmount element has AgeQualifyingCode = "10" with age brackets';
                }
                if (minage && maxage && Number(minage) >= Number(maxage)) {
                    throw 'invalid Rate: an AdditionalGuestAmount has MinAge >= MaxAge';
                }
                if (minage && Number(minage) > 21) {
                    throw 'invalid Rate: AdditionalGuestAmount: MinAge value too large';
                }
                if (maxage && Number(maxage) > 21) {
                    throw 'invalid Rate: AdditionalGuestAmount: MaxAge value too large';
                }
                ret.add_amt.push({
                    minage: minage ? Number(minage) : undefined,
                    maxage: maxage ? Number(maxage) : undefined,
                    agecode: agecod,
                    amount: Number(amount)
                });

            }

        }
    }

    check_uniqness(ret.add_amt);

    if (ret.add_amt.length > 0 && !ten_seen) {
        throw 'invalid Rate: when AdditionalGuestAmount elements are present, one with AgeQualifyingCode = "10" must be present';
    }

    return ret;

}


/* private functions */

function check_uniqness(add_amt) {

    var age, k, cnt;

    // each age should match 0 or 1 elements

    for (age = 0; age <= 21; age++) {
        cnt = 0;
        for (k = 0; k < add_amt.length; k++) {
            if (add_amt[k].agecode === '8') {
                if ((add_amt[k].minage === undefined || add_amt[k].minage <= age) &&
                    (add_amt[k].maxage === undefined || add_amt[k].maxage > age)) {
                    cnt++;
                }
            }
        }
        if (cnt > 1) {
            throw 'invalid Rate: more than one AdditionalGuestAmount element with AgeQualifyingCode = "8" match an age of ' + age;
        }
    }
}

function is_non_negative_int(a) {

    var s = String(a);
    var p = s.match(/^\d+$/);
    if (!p) {
        return false;
    }
    return true;
}

function is_positive_int(a) {

    if (is_non_negative_int(a) && a > 0) {
        return true;
    }
    return false;
}

function is_non_negative_float(a) {

    var s = String(a);
    if (s.match(/^\d+\.\d+$/) || s.match(/^\d+$/)) {
        return true;
    }
    return false;
}
