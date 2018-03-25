/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 utilrule.js - a set of functions to deal with AlpineBits BookingRule elements (stored as xm2js - JS objects)

 author: chris@1006.org

 */

'use strict';


exports.get_unique_codes = get_unique_codes;
exports.find_rules_by_code = find_rules_by_code;
exports.check_rules_overlap = check_rules_overlap;
exports.get_rule = get_rule;

var utildate = require('./utildate');


/**
 *  get a list of unique BookingRule -> Code attributes in the given RatePlan element
 *
 * @param   {Object}    rpel - a RatePlan element
 *
 * @returns {[String]}  an array of Code attribute values - if BookingRule elements with no Code (that are valid)
 *                      are encountered, the returned array has an additional undefined element at the end
 * @throws  {String}    in case of validation errors
 */
function get_unique_codes(rpel) {

    var i, c;

    var codes = {};

    var rules = rpel.BookingRules;

    if (rules) {

        if (rules.length > 1) {
            throw 'invalid RatePlan: more than one BookingRules elements';
        }

        var flag_nocode_seen = false;

        var rule = rules[0].BookingRule;

        if (rule) {

            for (i = 0; i < rule.length; i++) {

                if (rule[i].$ === undefined) {
                    throw 'invalid BookingRule: element BookingRule has not attributes';
                }
                c = rule[i].$.Code;
                if (c) {
                    codes[c] = 1;
                    if (rule[i].$.CodeContext !== 'ROOMTYPE') {
                        throw 'invalid BookingRule: invalid or missing CodeContext attribute';
                    }
                } else {
                    flag_nocode_seen = true;
                }
            }
        }

    }
    var ret = Object.keys(codes);

    if (flag_nocode_seen) {
        ret.push(undefined);
    }

    return ret;
}


/**
 *  find all BookingRule elements matching the given Code attribute under the given RatePlan element
 *
 * @param   {Object}    rpel - a RatePlan element
 * @param   {String}    brc  - Code to look for (might be undefined, to match rules with no Code attribute)
 *
 * @returns {[Object]}  an array of BookingRule elements
 * @throws  {String}    in case of validation errors
 */
function find_rules_by_code(rpel, brc) {

    var ret = [];
    var rules = rpel.BookingRules;

    if (rules) {

        if (rules.length > 1) {
            throw 'invalid RatePlan: more than one BookingRules elements';
        }
        var rule = rules[0].BookingRule;

        var i;
        for (i = 0; i < rule.length; i++) {
            if (rule[i].$ === undefined) {
                throw 'invalid BookingRule: element BookingRule has not attributes';
            }
            if (rule[i].$.Code !== brc) {
                continue;
            }
            ret.push(rule[i]);
        }
    }
    return ret;

}


/**
 *  detect start/end overlaps in a list of BookingRule elements
 *
 * @param   {[Object]}  brel_list - a list of BookingRule elements
 *
 * @returns {Number}    0 (all good)
 * @throws  {String}    in case of overlapping intervals
 */
function check_rules_overlap(brel_list) {

    var i, j;

    var a = [];
    for (i = 0; i < brel_list.length; i++) {
        a.push(get_rule(brel_list[i]));
    }

    for (i = 0; i < a.length; i++) {
        for (j = 0; j < a.length; j++) {
            if (j > i && utildate.date_interval_overlaps(a[i].start, a[i].end, a[j].start, a[j].end)) {
                throw 'invalid BookingRule: overlap detected';
            }
        }
    }

    return 0;

}


/**
 *  validate a BookingRule and extract useful information as flat JS Object
 *
 * @param   {Object}    brel - a BookingRule element
 *
 * @returns {Object}    the flat JS object with start, end, min_los, max_los, arrival_dow, departure_dow, status
 * @throws  {String}    in case of validation errors
 */
function get_rule(brel) {

    var ret = {};
    var i;

    // start/end

    ret.start = brel.$.Start;
    ret.end = brel.$.End;

    if (!utildate.is_valid_date(ret.start)) {
        throw 'invalid BookingRule: invalid or missing Start attribute';
    }
    if (!utildate.is_valid_date(ret.end)) {
        throw 'invalid BookingRule: invalid or missing End attribute';
    }
    if (utildate.date_diff(ret.start, ret.end) < 0) {
        throw 'invalid BookingRule: Start > End';
    }


    // min_los/max_los

    var stays, stay;

    ret.min_los = undefined; // default undefined (= unlimited)
    ret.max_los = undefined;

    stays = brel.LengthsOfStay;
    if (stays) {
        if (stays.length > 1) {
            throw 'invalid BookingRule: more than one LengthsOfStay elements';
        }
        stay = stays[0].LengthOfStay;
    }

    if (stay) {
        for (i = 0; i < stay.length; i++) {

            if (stay[i].$ === undefined) {
                throw 'invalid BookingRule: element LengthOfStay has not attributes';
            }

            var stay_t = stay[i].$.Time;
            var stay_tu = stay[i].$.TimeUnit;
            var stay_mmt = stay[i].$.MinMaxMessageType;

            if (!is_non_negative_int(stay_t)) {
                throw 'invalid BookingRule: invalid or missing Time attribute';
            }
            if (stay_tu !== 'Day') {
                throw 'invalid BookingRule: invalid or missing TimeUnit attribute';
            }
            if (stay_mmt === 'SetMinLOS') {
                if (ret.min_los === undefined) {
                    ret.min_los = Number(stay_t);
                } else {
                    throw 'invalid BookingRule: more than on LengthOfStay of type "SetMinLOS"';
                }
            } else if (stay_mmt === 'SetMaxLOS') {
                if (ret.max_los === undefined) {
                    ret.max_los = Number(stay_t);
                } else {
                    throw 'invalid BookingRule: more than on LengthOfStay of type "SetMaxLOS"';
                }
            } else {
                throw 'invalid BookingRule: invalid or missing value for attribute MinMaxMessageType';
            }
        }
        if (ret.min_los !== undefined && ret.max_los !== undefined && ret.min_los > ret.max_los) {
            throw 'invalid BookingRule: LengthOfStay values: min value > max value';
        }
    }

    // arrival_dow/departure_dow

    var dows, adow, ddow;
    var days = ['Sun', 'Mon', 'Tue', 'Weds', 'Thur', 'Fri', 'Sat'];

    ret.arrival_dow = [true, true, true, true, true, true, true];    // default: allow
    ret.departure_dow = [true, true, true, true, true, true, true];

    dows = brel.DOW_Restrictions;
    if (dows) {
        if (dows.length > 1) {
            throw 'invalid BookingRule: more than one DOW_Restrictions elements';
        }
        adow = dows[0].ArrivalDaysOfWeek;
        ddow = dows[0].DepartureDaysOfWeek;
    }

    if (adow) {
        if (adow.length > 1) {
            throw 'invalid BookingRule: more than one ArrivalDaysOfWeek elements';
        }
        adow = adow[0];
        for (i = 0; i < days.length; i++) {
            if (adow.$ !== undefined && adow.$[days[i]]) {
                if ((adow.$[days[i]]).match(/^(1|true)$/i)) {
                    ret.arrival_dow[i] = true;
                } else if ((adow.$[days[i]]).match(/^(0|false)$/i)) {
                    ret.arrival_dow[i] = false;
                } else {
                    throw 'invalid BookingRule: invalid week day attribute value in ArrivalDaysOfWeek element';
                }
            }
        }
    }

    if (ddow) {
        if (ddow.length > 1) {
            throw 'invalid BookingRule: more than one DepartureDaysOfWeek elements';
        }
        ddow = ddow[0];
        for (i = 0; i < days.length; i++) {
            if (ddow.$ !== undefined && ddow.$[days[i]]) {
                if ((ddow.$[days[i]]).match(/^(1|true)$/i)) {
                    ret.departure_dow[i] = true;
                } else if ((ddow.$[days[i]]).match(/^(0|false)$/i)) {
                    ret.departure_dow[i] = false;
                } else {
                    throw 'invalid BookingRule: invalid week day attribute value in DepartureDaysOfWeek element';
                }
            }
        }
    }

    // status

    ret.status = 'Open'; // default: Open

    var rs = brel.RestrictionStatus;

    if (rs) {
        if (rs.length !== 1) {
            throw 'invalid BookingRule: more than one RestrictionStatus elements';
        }
        if (rs[0].$ === undefined) {
            throw 'invalid BookingRule: RestrictionStatus element has no attributes';

        }
        var rs_res = rs[0].$.Restriction;
        var rs_st = rs[0].$.Status;
        if (rs_res !== 'Master') {
            throw 'invalid BookingRule: invalid or missing Restriction attribute';
        }
        if (rs_st !== 'Open' && rs_st !== 'Close') {
            throw 'invalid BookingRule: invalid or missing Status attribute';
        }
        ret.status = rs_st;
    }

    return ret;

}


/* private functions */


function is_non_negative_int(a) {

    var s = String(a);
    var p = s.match(/^\d+$/);
    if (!p) {
        return false;
    }
    return true;
}