/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018-2019 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 engine.js - the rtapp engine

 see function run() for the entry point

 limitations:

 - deltas are not supported, RatePlan elements must have RatePlanNotifType = "New"
 - elements not relevant to the cost computation (such as MealsIncluded or Descriptions) are ignored
 - non-mandatory supplements are not considered, make them temporarily mandatory if you wish to test them
 - guests that exceed the max inventory cannot automatically be spread across more than one room

 note that intermediate results are shown to three digits, the total cost is then rounded to two digits
 (see the comment at https://github.com/alpinebits/rtapp-201507/issues/1#issuecomment-365328873 )

 author: chris@1006.org

 */

"use strict";


exports.run = run;

var xml2js = require('xml2js');
var deasync = require('deasync');
var parseStringSync = deasync(xml2js.parseString);

var utildate = require('./utildate');
var utildisc = require('./utildisc');
var utilrate = require('./utilrate');
var utilrule = require('./utilrule');
var utilsupp = require('./utilsupp');


/**
 * main entry point
 *
 * @param   {Object}    job - all the input data (see cli.js for example usage)
 *
 * @returns {Object}    results and debug info (result, info1, info2)
 * @throws  {String}    if there was a validation error
 */
function run(job) {

    var i, c, k;

    info1_buf = info2_buf = '';


    // validate arrival, departure, num_adults and children_ages

    if (!utildate.is_valid_date(job.arrival)) {
        throw 'job parameter: arrival: invalid date';
    }
    if (!utildate.is_valid_date(job.departure)) {
        throw 'job parameter: departure: invalid date';
    }
    if (utildate.date_diff(job.arrival, job.departure) <= 0) {
        throw 'job parameters: arrival, departure: time travel not invented yet';
    }
    if (!(String(job.num_adults).match(/^\d{1,3}$/))) {
        throw 'job parameter: num_adults: invalid value';
    }
    job.num_adults = Number(job.num_adults);
    if (!(job.children_ages instanceof Array)) {
        throw 'job parameter: children_ages: array expected';
    }
    for (i = 0; i < job.children_ages.length; i++) {
        if (!(String(job.children_ages[i]).match(/^\d{1,3}$/))) {
            throw 'job parameter: children_ages[' + i + ']: invalid value';
        }
        job.children_ages[i] = Number(job.children_ages[i]);
    }
    if (job.num_adults + job.children_ages.length === 0) {
        throw 'job parameters: num_adults, children_ages: need at least one occupant';
    }
    if (job.booking_date === undefined) {
        job.booking_date = utildate.date_today();
    }
    if (!utildate.is_valid_date(job.booking_date)) {
        throw 'job parameter: booking_date: invalid date';
    }

    //  validate occupancy and break the array into an object for easy lookup by code

    var invocc = {};

    if (!(job.occupancy instanceof Array) || job.occupancy.length % 5 !== 0) {
        throw 'job parameter: inventory occupancy: array with a multiple of five values expected';
    }
    for (i = 0; i < job.occupancy.length / 5; i++) {
        var key = String(job.occupancy[i * 5]);
        var min = String(job.occupancy[i * 5 + 1]);
        var std = String(job.occupancy[i * 5 + 2]);
        var max = String(job.occupancy[i * 5 + 3]);
        var mch = String(job.occupancy[i * 5 + 4]);
        if (key === '') {
            throw 'job parameter: inventory occupancy: invalid code';
        }
        if (invocc[key]) {
            throw 'job parameter: inventory occupancy: values for code are not unique';
        }
        if (!is_positive_int(min)) {
            throw 'job parameter: inventory occupancy: invalid min value';
        }
        if (!is_positive_int(std)) {
            throw 'job parameter: inventory occupancy: invalid std value';
        }
        if (!is_positive_int(max)) {
            throw 'job parameter: inventory occupancy: invalid max value';
        }
        if (mch !== 'undefined' && !is_non_negative_int(mch)) {
            throw 'job parameter: inventory occupancy: invalid max child occupancy value';
        }
        if (!(Number(min) <= Number(std)) || !(Number(std) <= Number(max))) {
            throw 'job parameter: inventory occupancy: values must be min <= std <= max';
        }
        if (mch !== 'undefined' && (Number(mch) > Number(max))) {
            throw 'job parameter: inventory occupancy: max child occupancy value cannot exceed max value';
        }
        invocc[key] = {
            min: Number(min),
            std: Number(std),
            max: Number(max),
            mch: (mch === 'undefined' ? undefined : Number(mch))
        };
    }


    // parse the rate plans message in job.rpmsg_data (XML) into rpmsg (JS object)

    var rpmsg;

    try {
        rpmsg = parseStringSync(job.rpmsg_data);
    } catch (ex) {
        throw 'job parameter: rpmsg_data: XML parse error';
    }


    // extract RatePlan elements

    var plans = find_plans(rpmsg);

    var obj, res;

    var rate_codes, rates;
    var rule_codes, rules;
    var supp_codes, merged_supp;
    var discount;


    // PART 1:
    // do a validation loop over the RatePlan elements

    for (i = 0; i < plans.length; i++) {

        info1('RatePlan ' + (i + 1) + '/' + plans.length + ' (RatePlanCode = ' + plans[i].$.RatePlanCode + '):');

        var static_data = utilrate.get_static_data(plans[i]);
        info1('    +-- static Rate data: UnitMultiplier = ' + static_data.UnitMultiplier + ', Type = ' + static_data.Type);


        rate_codes = utilrate.get_unique_codes(plans[i]);

        for (c = 0; c < rate_codes.length; c++) {

            info1('    +-- dynamic Rate data for InvTypeCode = "' + rate_codes[c] + '":');

            rates = utilrate.find_rates_by_code(plans[i], rate_codes[c]);

            for (k = 0; k < rates.length; k++) {

                obj = utilrate.get_rate(rates[k], static_data);

                info1('        +-- Rate ' + (k + 1) + '/' + rates.length + ':');
                info1('            | start/end:      ' + obj.start + ' .. ' + obj.end);
                info1('            | nights:         ' + obj.night_cnt);
                Object.keys(obj.base_amt).forEach(function (el) {
                    info1('            | BaseByGuestAmt: ' + el + ' pax -> ' + obj.base_amt[el].amtat + ' EUR');
                });
                obj.add_amt.forEach(function (el) {
                    if (el.agecode === '10') {
                        info1('            | AdditionalGuestAmounts: adult -> ' + el.amount + ' EUR');
                    } else {
                        info1('            | AdditionalGuestAmounts: agecode = ' + el.agecode + ', ' + el.minage + ' <= age < ' + el.maxage + ' -> ' + el.amount + ' EUR');
                    }
                });

            }
            utilrate.check_rates_overlap(rates, static_data);
            info1('        +-- no overlap detected');

        }

        rule_codes = utilrule.get_unique_codes(plans[i]);

        for (c = 0; c < rule_codes.length; c++) {

            if (rule_codes[c] === undefined) {
                info1('    +-- generic BookingRule data:');
            } else {
                info1('    +-- specific BookingRule data for Code = "' + rule_codes[c] + '":');
            }

            rules = utilrule.find_rules_by_code(plans[i], rule_codes[c]);

            for (k = 0; k < rules.length; k++) {
                obj = utilrule.get_rule(rules[k]);
                info1('        +-- BookingRule ' + (k + 1) + '/' + rules.length + ':');
                info1('            | Start/End:  ' + obj.start + ' .. ' + obj.end);
                info1('            | LOS:        ' + obj.min_los + ' .. ' + obj.max_los);
                info1('            | Forward:    ' + obj.fwd_min_stay + ' .. ' + obj.fwd_max_stay);
                info1('            | arr. DOW:   ' + obj.arrival_dow.join(', '));
                info1('            | dep. DOW:   ' + obj.departure_dow.join(', '));
                info1('            | res. stat.: ' + obj.status);
            }
            utilrule.check_rules_overlap(rules);
            info1('        +-- no overlap detected');

        }

        supp_codes = utilsupp.get_unique_codes(plans[i]);

        if (supp_codes.length > 0) {
            info1('    +-- Supplements:');
        }

        for (c = 0; c < supp_codes.length; c++) {

            merged_supp = utilsupp.get_merged_supp_by_code(plans[i], supp_codes[c]);

            info1('        +-- Supplement (merged) ' + (c + 1) + '/' + supp_codes.length
                + ' (InvCode = ' + supp_codes[c]
                + ', ChargeTypeCode = ' + merged_supp.ctc
                + ', MandatoryIndicator = ' + merged_supp.mandatory
                + ', PrerequisiteInventory = ' + merged_supp.pre_dow + '):');

            for (k = 0; k < merged_supp.dyn.length; k++) {
                info1('            | '
                    + merged_supp.dyn[k].start + ' .. ' + merged_supp.dyn[k].end
                    + ' -> ' + merged_supp.dyn[k].amount + ' EUR '
                    + (merged_supp.dyn[k].pre_room !== undefined ? ('(applicable to InvCode = "' + merged_supp.dyn[k].pre_room + '")') : '(applicable to any)')
                );
            }

        }

        discount = utildisc.get_discount(plans[i]);

        info1('    +-- OfferRule restrictions:');
        info1('            | LOS:        ' + discount.restrictions.min_los + ' .. ' + discount.restrictions.max_los);
        info1('            | arr. DOW:   ' + discount.restrictions.arrival_dow.join(', '));
        info1('            | dep. DOW:   ' + discount.restrictions.departure_dow.join(', '));
        info1('            | adv.bk:     ' + discount.restrictions.min_advanced + ' .. ' + discount.restrictions.max_advanced);

        if (discount.restrictions.adult_minage === undefined) {
            info1('            | no Occupancy MinAge given: all guests are considered adults');
        } else {
            info1('            | all guests < ' + discount.restrictions.adult_minage + ' years old are considered children');
        }

        if (discount.restrictions.adult_minocc !== undefined || discount.restrictions.adult_maxocc !== undefined) {
            info1('            | adult occupancy restrictions: ' + discount.restrictions.adult_minocc + ' .. ' + discount.restrictions.adult_maxocc);
        } else {
            info1('            | no adult occupancy restrictions');
        }

        if (discount.restrictions.child_minage !== undefined || discount.restrictions.child_maxage !== undefined) {
            info1('            | children ages are restricted to ' + discount.restrictions.child_minage + ' <= age < ' + discount.restrictions.child_maxage + '');
        } else {
            info1('            | children ages are not restricted');
        }

        if (discount.restrictions.child_minocc !== undefined || discount.restrictions.child_maxocc !== undefined) {
            info1('            | children occupancy restrictions: ' + discount.restrictions.child_minocc + ' .. ' + discount.restrictions.child_maxocc);
        } else {
            info1('            | no children occupancy restrictions');
        }

        if (discount.type_free_nights) {
            if (discount.patt === undefined) {
                info1('    +-- Free nights discount: the last ' + discount.ndis + ' night(s) of the stay are free (only where rates have UnitMultiplier == 1)'
                );
            } else {
                info1('    +-- Free nights discount: for each ' + discount.nreq + ' night(s) of stay, '
                    + 'the last ' + discount.ndis + ' night(s) are free (only where rates have UnitMultiplier == 1)'
                );
            }
        }

        if (discount.type_family) {
            info1('    +-- Family discount:      ' + discount.freecnt + ' child(ren) below age ' +
                discount.maxage + ' stay(s) free, when at least ' + discount.mincnt + ' child(ren) below that age is (are) present');
        }

    }


    // PART 2:
    // try to match a stay and compute the cost

    var match_accum = {};
    var wrong_child_age;


    // *** for each RatePlan

    for (i = 0; i < plans.length; i++) {

        info2('RatePlan ' + (i + 1) + '/' + plans.length + ' (RatePlanCode = ' + plans[i].$.RatePlanCode + '):');

        rate_codes = utilrate.get_unique_codes(plans[i]);

        discount = utildisc.get_discount(plans[i]);

        // *** for each InvTypeCode

        for (c = 0; c < rate_codes.length; c++) {

            info2('    +-- InvTypeCode = ' + rate_codes[c] + ':');


            // step 0: -------------------------------------------------------------------------------------------------
            // find inventory occupancy data and compute the minimum number of guests required to pay the full rate

            var io = invocc[rate_codes[c]];
            if (!io) {
                info2('        +-- no inventory occupancy for this code -> skipping');
                continue;
            }

            var full_payers_needed;
            if (io.mch === undefined) {
                full_payers_needed = io.std;
            } else {
                full_payers_needed = Math.max(io.min, Math.min(io.max - io.mch, io.std));
            }

            info2('        +-- inventory occupancy: min = ' + io.min + ', std = ' + io.std + ', max = ' + io.max +
                ', max child occupancy = ' + io.mch + ', min full rate payers = ' + full_payers_needed);


            // step 1 (total occupancy check): -------------------------------------------------------------------------
            // check whether the total number of guests (adults + children) is compatible with min/max inventory occupancy

            info2('        +-- guests: ' + job.num_adults + ' adults(s) and ' + job.children_ages.length +
                ' child(ren)' + (job.children_ages.length > 0 ? ' (ages: ' + job.children_ages.join(', ') + ')' : '') );

            if (job.num_adults + job.children_ages.length < io.min) {
                info2('            +-- the total number of guests is less than the inventory occupancy minimum -> skipping');
                continue;
            }
            if (job.num_adults + job.children_ages.length > io.max) {
                info2('            +-- the total number of guests exceeds the inventory occupancy maximum -> skipping');
                continue;
            }

            // step 1b (offer rule check): -----------------------------------------------------------------------------
            // check whether the first Offer element forbids the stay

            if (discount.restrictions.adult_minage === undefined && job.children_ages.length !== 0) {
                info2('            | according to OfferRule restrictions, all guests are considered adults - however, children are present in the stay -> skipping');
                continue;
            }

            wrong_child_age = false;
            if (discount.restrictions.adult_minage !== undefined && job.children_ages.length > 0) {
                for (k = 0; k < job.children_ages.length; k++) {
                    // all guests >= MinAge are considered "adults"
                    if (job.children_ages[k] >= discount.restrictions.adult_minage) {
                        info2('            | according to OfferRule restrictions, all guests >= ' + discount.restrictions.adult_minage + ' are to be considered adults - however a child with age (' + job.children_ages[k] + ') is present in the stay -> skipping');
                        wrong_child_age = true;
                        break;
                    }
                }
            }
            if (wrong_child_age) {
                continue;
            }

            wrong_child_age = false;
            for (k = 0; k < job.children_ages.length; k++) {
                // the age of “children” is restricted to the interval MinAge <= age < MaxAge
                if (discount.restrictions.child_minage !== undefined && job.children_ages[k] < discount.restrictions.child_minage) {
                    info2('            | guest child age (' + job.children_ages[k] + ') conflicts with OfferRule minimum child age (' + discount.restrictions.child_minage + ') -> skipping');
                    wrong_child_age = true;
                    break;
                }
                if (discount.restrictions.child_maxage !== undefined && job.children_ages[k] >= discount.restrictions.child_maxage) {
                    info2('            | guest child age (' + job.children_ages[k] + ') conflicts with OfferRule maximum child age (' + discount.restrictions.child_maxage + ') -> skipping');
                    wrong_child_age = true;
                    break;
                }
            }
            if (wrong_child_age) {
                continue;
            }

            if (discount.restrictions.adult_minocc !== undefined && job.num_adults < discount.restrictions.adult_minocc) {
                info2('            | OfferRule restrictions: adult MinOccupancy mot reached -> skipping');
                continue;
            }
            if (discount.restrictions.adult_maxocc !== undefined && job.num_adults > discount.restrictions.adult_maxocc) {
                info2('            | OfferRule restrictions: adult MaxOccupancy exceeded -> skipping');
                continue;
            }
            if (discount.restrictions.child_minocc !== undefined && job.children_ages.length < discount.restrictions.child_minocc) {
                info2('            | OfferRule restrictions: children MinOccupancy mot reached -> skipping');
                continue;
            }
            if (discount.restrictions.child_maxocc !== undefined && job.children_ages.length > discount.restrictions.child_maxocc) {
                info2('            | OfferRule restrictions: children MaxOccupancy exceeded -> skipping');
                continue;
            }

            res = find_offerrule_restrictions(job.arrival, job.departure, discount);
            if (res !== undefined) {
                info2('            +-- stay is restricted by OfferRule (' + res + ') -> skipping');
                continue;
            }

            if (discount.restrictions.min_advanced !== undefined && utildate.date_diff(job.booking_date, job.arrival) < discount.restrictions.min_advanced) {
                info2('            | OfferRule restrictions: cannot book ' + utildate.date_diff(job.booking_date, job.arrival) + ' day(s) in advance if MinAdvancedBookingOffset is ' + discount.restrictions.min_advanced);
                continue;
            }
            if (discount.restrictions.max_advanced !== undefined && utildate.date_diff(job.booking_date, job.arrival) > discount.restrictions.max_advanced) {
                info2('            | OfferRule restrictions: cannot book ' + utildate.date_diff(job.booking_date, job.arrival) + ' day(s) in advance if MaxAdvancedBookingOffset is ' + discount.restrictions.max_advanced);
                continue;
            }

            // step 2 (transformation): --------------------------------------------------------------------------------
            // while the number of adults is less than full_payers_needed and children are present,
            // transform children to adults starting from the oldest child

            // from here on we work on a copy of the guests (note children are ordered by age):
            // eff_adult and eff_child

            var eff_adult = job.num_adults;
            var eff_child = [];
            job.children_ages.forEach(function (el) {
                eff_child.push(el);
            });
            eff_child.sort(function (a, b) {
                return a - b;
            });

            // promote children

            while (eff_adult < full_payers_needed && eff_child.length > 0) {
                eff_child.pop();
                eff_adult++;
            }

            // log transformations, if there were any

            if (eff_adult != job.num_adults) {
                info2('            +-- children were transformed to adults');
                info2('            +-- effective guests: ' + eff_adult + ' adults(s) and ' + eff_child.length + ' child(ren) (ages: ' + eff_child.join(', ') + ')');
            }


            // step 3 (family offers): ---------------------------------------------------------------------------------
            // apply family discounts, if there are any

            var family_discount_applied = false;
            var num_applied = 0;

            if (discount.type_family) {

                var num_to_apply = 0;
                for (k = 0; k < eff_child.length; k++) {
                    if (eff_child[k] < discount.maxage) {
                        num_to_apply++;
                    }
                }

                if (num_to_apply >= 1 && num_to_apply >= discount.mincnt) {

                    while (num_applied < num_to_apply && num_applied < discount.freecnt) {
                        for (k = 0; k < eff_child.length; k++) {
                            if (eff_child[k] < discount.maxage) {
                                eff_child.splice(k, 1);
                                num_applied++;
                                break;
                            }
                        }
                    }
                    family_discount_applied = true;

                    info2('            +-- a family discount was applied: ' + num_applied + ' child(ren) below age ' + discount.maxage + ' stay(s) free');
                    info2('            +-- effective guests: ' + eff_adult + ' adults(s) and ' + eff_child.length + ' child(ren) (ages: ' + eff_child.join(', ') + ')');

                }

            }

            // print stay summary with night count

            info2('        +-- stay: arrival on ' + job.arrival + ', departure on ' + job.departure + ' (' + utildate.date_diff(job.arrival, job.departure) + ' night(s))');


            // step 4a (restriction checks): ---------------------------------------------------------------------------
            // check BookingRule restrictions

            res = find_restrictions(job.arrival, job.departure, plans[i], rate_codes[c]);

            if (res !== undefined) {
                info2('            +-- stay is restricted by booking rules (' + res + ') -> skipping');
                continue;
            }

            info2('            +-- stay is not restricted by any booking rule');


            // step 4b (compute cost): ---------------------------------------------------------------------------------
            // compute the cost, matching the single rates

            // find matching rates - if none are found, the stay is not possible

            var rmatch = match_rates(job.arrival, job.departure, eff_adult, eff_child, io, plans[i], rate_codes[c], discount, num_applied);

            if (rmatch.nomatch_reason) {
                info2('            +-- no matching rates for the stay (' + rmatch.nomatch_reason + ') -> skipping');
                continue;
            }

            // note: unlike 2015-07b, 2017-10 allows matching rate plans that have offers that are not applicable to a stay

            info2('        +-- matching rates for the stay (total contribution ' + round3(rmatch.cost_total) + ' EUR):');
            for (k = 0; k < rmatch.cost_details.length; k++) {
                info2('            +-- ' + rmatch.cost_details[k]);
            }


            // find matching (mandatory) supplements

            var smatch = match_supps(job.arrival, job.departure, eff_adult + eff_child.length, plans[i], rmatch.fn_hash, rate_codes[c]);

            if (smatch.cost_details.length === 0) {
                info2('        +-- no matching, mandatory supplements for the stay');
            } else {
                info2('        +-- matching, mandatory supplements for the stay (total contribution ' + round3(smatch.cost_total) + ' EUR):');
                for (k = 0; k < smatch.cost_details.length; k++) {
                    info2('            +-- ' + smatch.cost_details[k]);
                }
            }

            info2('        +-- total cost: ' + round2(rmatch.cost_total + smatch.cost_total) + ' EUR');

            match_accum[rate_codes[c]] = Number(round2(rmatch.cost_total + smatch.cost_total));

        }

    }

    return {info1: info1_buf, info2: info2_buf, result: match_accum};


}


/* private functions */


function find_plans(rpmsg) {

    // extract and return the RatePlan elements from the given rate plans message

    var i, c;

    var root = rpmsg.OTA_HotelRatePlanNotifRQ;
    var rps, rp, rp_codes = {};

    if (root) {
        rps = root.RatePlans;
        if (rps && rps.length === 1) {
            rp = rps[0].RatePlan;
        }
    }

    if (!rp) {
        throw 'invalid rate plans message: cannot find a RatePlan element';
    }

    for (i = 0; i < rp.length; i++) {
        if (rp[i].$.RatePlanNotifType !== 'New') {
            throw 'rtapp can only deal with RatePlan elements with RatePlanNotifType = "New"';
        }
        if (rp[i].$.CurrencyCode !== 'EUR') {
            throw 'invalid RatePlan: CurrencyCode must be "EUR"';
        }
        c = rp[i].$.RatePlanCode;
        if (c) {
            if (rp_codes[c]) {
                throw 'invalid RatePlan: RatePlanCode is not unique'
            } else {
                rp_codes[c] = 1;
            }
        } else {
            throw 'invalid RatePlan: missing RatePlanCode';
        }
    }

    return rp;

}


function find_restrictions(arr, dep, rpel, code) {

    var dt, i, a;

    var los = utildate.date_diff(arr, dep);

    var rules = [];

    a = utilrule.find_rules_by_code(rpel, code); // rules with with Code attribute
    for (i = 0; i < a.length; i++) {
        rules.push(utilrule.get_rule(a[i]));
    }
    a = utilrule.find_rules_by_code(rpel, undefined); // generic rules
    for (i = 0; i < a.length; i++) {
        rules.push(utilrule.get_rule(a[i]));
    }

    // RestrictionStatus
    // (each day of the stay (excluding the departure day) must not be denied by a master status Close rule)

    dt = arr;
    while (utildate.date_diff(dt, dep) > 0) {
        for (i = 0; i < rules.length; i++) {
            if (utildate.date_between(rules[i].start, rules[i].end, dt) && rules[i].status !== 'Open') {
                return 'master restriction status closed for ' + dt;
            }
        }
        dt = utildate.date_add(dt, 1);
    }

    // LOS and DOW

    for (i = 0; i < rules.length; i++) {

        // if start <= departure day <= end, just check the departure DOW

        if (utildate.date_between(rules[i].start, rules[i].end, dep)) {
            if (rules[i].departure_dow[utildate.date_dow(dep)] !== true) {
                return 'departure dow restriction applies';
            }
        }

        // if start <= arrival day <= end, check arrival DOW and LOS

        if (utildate.date_between(rules[i].start, rules[i].end, arr)) {
            if (rules[i].arrival_dow[utildate.date_dow(arr)] !== true) {
                return 'arrival dow restriction applies';
            }
            if (rules[i].min_los != undefined && los < rules[i].min_los) {
                return ('length of stay (' + los + ') is below minimum (' + rules[i].min_los + ')');
            }
            if (rules[i].max_los != undefined && los > rules[i].max_los) {
                return ('length of stay (' + los + ') is above maximum (' + rules[i].max_los + ')');
            }
        }
    }

    // SetForwardMinStay and SetForwardMaxStay:
    // like LOS, but must be checked for each day of the stay *including* (see Uli test case #27) the departure day

    dt = arr;
    while (utildate.date_diff(dt, dep) >= 0) {
        for (i = 0; i < rules.length; i++) {
            if (utildate.date_between(rules[i].start, rules[i].end, dt)) {
                if (rules[i].fwd_min_stay !== undefined && los < rules[i].fwd_min_stay) {
                    return ('on ' + dt + ', length of stay (' + los + ') is below forward minimum (' + rules[i].fwd_min_stay + ')');
                }
                if (rules[i].fwd_max_stay !== undefined && los > rules[i].fwd_max_stay) {
                    return ('on ' + dt + ', length of stay (' + los + ') is above forward maximum (' + rules[i].fwd_max_stay + ')');
                }
            }
        }
        dt = utildate.date_add(dt, 1);
    }

    return undefined; // no restriction found

}

function find_offerrule_restrictions(arr, dep, discount) {

    var d;

    d = utildate.date_diff(arr, dep);
    if (discount.restrictions.min_los !== undefined && d < discount.restrictions.min_los) {
        return ('length of stay (' + d + ') is below minimum (' + discount.restrictions.min_los + ')');
    }

    if (discount.restrictions.max_los !== undefined && d > discount.restrictions.max_los) {
        return ('length of stay (' + d + ') exceeds maximum (' + discount.restrictions.max_los + ')');
    }

    if (discount.restrictions.arrival_dow !== undefined && discount.restrictions.arrival_dow[utildate.date_dow(arr)] !== true) {
        return 'arrival dow is forbidden';
    }

    if (discount.restrictions.departure_dow !== undefined && discount.restrictions.departure_dow[utildate.date_dow(dep)] !== true) {
        return 'departure dow is forbidden';
    }

    return undefined; // no restriction found

}



function match_rates(arr, dep, eff_adult, eff_child, io, rpel, code, discount, num_free_kids) {

    var dt;
    var i, j, k;
    var a;

    for (i = 1; i < eff_child.length; i++) {
        assert(eff_child[i] >= eff_child[i - 1], 'unexpectedly, children are not sorted yet in match_rates()');
    }

    var rates = [];

    var static_data = utilrate.get_static_data(rpel);

    a = utilrate.find_rates_by_code(rpel, code);

    for (i = 0; i < a.length; i++) {
        rates.push(utilrate.get_rate(a[i], static_data));
    }

    // loop over the days in the stay and match them against the rates, adding the cost

    dt = arr;
    var cost_total = 0;
    var cost_details = [];

    var fn_hash = {};

    while (utildate.date_diff(dt, dep) > 0) {

        var sdate, edate, chunk, chunk_weight, chunk_weight_str;

        var rate_found = false;
        var rate_found_chunk;
        var cost = 0;
        var cost_items = [];
        var extra_reason = '';
        var am;

        for (i = 0; i < rates.length; i++) {

            sdate = rates[i].start;
            edate = rates[i].end;

            // skip rate immediately, if it doesn't contain dt at all

            if (utildate.date_diff(sdate, dt) < 0 || utildate.date_diff(dt, edate) < 0) {
                continue; // try next rate
            }

            // in this step, the largest chunk of nights that can be matched is given by the minimum of these three:
            //   * number of nights left in this stay
            //   * number of nights left in this rate
            //   * this rate's night_count (see attribute UnitMultiplier)

            chunk = Math.min(utildate.date_diff(dt, dep), utildate.date_diff(dt, edate) + 1, rates[i].night_cnt);

            assert(chunk >= 1, 'unexpected value ' + chunk + ' for chunk in match_rates()');
            chunk_weight_str = chunk + '/' + rates[i].night_cnt;
            chunk_weight = chunk / rates[i].night_cnt;


            // note: the so-called temporary transformation step in 2015-07b has been removed in 2017-10


            // proceed as follows:
            //   (a) up to std adults are matched by the BaseByGuestAmt element
            //       (corresponding to a NumberOfGuests value computed from the rate type)
            //   (b) any remaining adults are matched by AdditionalGuestAmount with AgeQualifyingCode = "10" (adult)
            //   (c) all the children are matched by AdditionalGuestAmount elements

            // (a)

            var base_adults = Math.min(eff_adult, io.std);
            if (base_adults > 0) {
                if (rates[i].base_amt_type === "7") {
                    var num_of_guests = Math.min(eff_adult + eff_child.length + num_free_kids, io.std);
                    if (rates[i].base_amt[num_of_guests]) {
                        am = rates[i].base_amt[num_of_guests].amtat * chunk_weight * base_adults / num_of_guests;
                        cost += am;
                        cost_items.push(round3(am));
                    } else {
                        extra_reason = ', no BaseByGuestAmt with NumberOfGuests = ' + num_of_guests + ' found';
                        break; // the for-rates loop: no other rates need to be checked
                    }
                } else if (rates[i].base_amt_type === "25") {
                    if (rates[i].base_amt[base_adults]) {
                        am = rates[i].base_amt[base_adults].amtat * chunk_weight;
                        cost += am;
                        cost_items.push(round3(am));
                    } else {
                        extra_reason = ', no BaseByGuestAmt with NumberOfGuests = ' + base_adults + ' found';
                        break; // the for-rates loop: no other rates need to be checked
                    }
                } else {
                    assert(false, 'unexpected type');
                }
            }

            // (b)

            var addi_adults = eff_adult - base_adults;

            var a_matched = false;
            if (addi_adults > 0) {
                for (k = 0; k < rates[i].add_amt.length; k++) {
                    if (rates[i].add_amt[k].agecode === '10') {
                        am = addi_adults * rates[i].add_amt[k].amount * chunk_weight;
                        cost += am;
                        cost_items.push(round3(am));
                        a_matched = true;
                        break;
                    }
                }
                if (!a_matched) {
                    extra_reason = ', no AdditionalGuestAmount found (for adults above std occupancy)';
                    break; // the for-rates loop: no other rates need to be checked
                }
            }

            // (c)

            var c_matched_cnt = 0;

            for (j = 0; j < eff_child.length; j++) {

                var c_this_matched = false;

                // match the child with an age code 8 in the right bracket...

                for (k = 0; k < rates[i].add_amt.length; k++) {
                    if (rates[i].add_amt[k].agecode === '8') {
                        if ((rates[i].add_amt[k].minage === undefined || eff_child[j] >= rates[i].add_amt[k].minage) &&
                            (rates[i].add_amt[k].maxage === undefined || eff_child[j] < rates[i].add_amt[k].maxage)) {
                            am = rates[i].add_amt[k].amount * chunk_weight;
                            cost += am;
                            cost_items.push(round3(am));
                            c_this_matched = true;
                            break; // the for-amounts loop
                        }
                    }
                }

                if (c_this_matched) {
                    c_matched_cnt++;
                } else {
                    // a missing age bracket disallows this rate to be applied
                    extra_reason = ', no AdditionalGuestAmount found for child aged ' + eff_child[j];
                    break;
                }

            }

            if (c_matched_cnt !== eff_child.length) {
                break; // the for-rates loop: no other rates need to be checked
            }


            rate_found_chunk = chunk;
            rate_found = true;
            break; // the for loop: no other rates need to be checked

        }

        if (rate_found) {

            // got a rate for dt (+nc), now check if there is any "free nights" discount to apply;

            // note that a free nights discount can only be applied (make the night free), if the matching
            // rate has UnitMultiplier of 1, hence the extra condition: rate_found_chunk === 1

            // in 2017-10, if the pattern is defined, the discount can be applied multiple times,
            // otherwise just once at the end of the stay

            var fn_applied = false;
            if (discount.type_free_nights && utildate.date_diff(arr, dep) >= discount.nreq && rate_found_chunk === 1) {

                if (discount.patt !== undefined) {
                    // apply multiple times according to pattern
                    var fn_index = utildate.date_diff(arr, dt) % discount.nreq;
                    if (fn_index >= discount.nreq - discount.ndis) {
                        cost_details.push(round3(0.0) + ' EUR for ' + dt + ' (' + chunk + ' nights) matched by rate ' +
                            sdate + ' .. ' + edate + ' (repeating free nights discount applies)');
                        fn_applied = true;
                        fn_hash[dt] = true;
                    }
                } else {
                    // apply at the end of the stay
                    if (utildate.date_diff(dt, dep) <= discount.ndis) {
                        cost_details.push(round3(0.0) + ' EUR for ' + dt + ' (' + chunk + ' nights) matched by rate ' +
                            sdate + ' .. ' + edate + ' (non-repeating free nights discount applies)');
                        fn_applied = true;
                        fn_hash[dt] = true;
                    }
                }
            }
            if (!fn_applied) {
                var s;
                if (Math.abs(chunk_weight - 1) > 0.0001) {
                    s = '(fraction ' + chunk_weight_str + ') ';
                } else {
                    s = '';
                }
                cost_details.push(round3(cost) + ' EUR ' + s + 'for ' + dt + ' (' + chunk + ' nights) matched by rate ' +
                    sdate + ' .. ' + edate + ' (' + cost_items.join(' + ') + ')');
                cost_total += cost;
            }

        } else {

            return {nomatch_reason: 'first unmatched date is ' + dt + extra_reason};

        }

        dt = utildate.date_add(dt, chunk); // next date to match

    }

    return {
        cost_details: cost_details,
        cost_total: Number(round3(cost_total)),
        fn_hash: fn_hash
    };

}


function match_supps(arr, dep, stay_pax, rpel, fn_hash, invtypecode) {

    var dt;
    var i, k;

    var codes = utilsupp.get_unique_codes(rpel);

    var stay_nights = utildate.date_diff(arr, dep);

    var cost_details = [];
    var cost_total = 0;


    // consider all supplement codes

    for (i = 0; i < codes.length; i++) {

        var merged_supp = utilsupp.get_merged_supp_by_code(rpel, codes[i]);

        if (!merged_supp.mandatory) {
            continue;
        }

        // loop over the days in the stay and match them against the supplement, adding the cost

        dt = arr;

        while (utildate.date_diff(dt, dep) > 0) {

            var dowix = utildate.date_dow(dt) - 1;
            if (dowix < 0) {
                dowix += 7;
            }

            var matching_amount = undefined;

            // in 2017-10, if there is prerequisite invcode pattern, the supplement is only applied on dows with a pattern of 1
            if (merged_supp.pre_dow === undefined || (merged_supp.pre_dow.split(""))[dowix] === "1" ) {

                // in 2017-10, there might be a up to two supplements matching here due prerequisite roomtype being undefined or matching invtypecode
                for (k = 0; k < merged_supp.dyn.length; k++) {
                    if (utildate.date_between(merged_supp.dyn[k].start, merged_supp.dyn[k].end, dt) &&
                        (merged_supp.dyn[k].pre_room === undefined || merged_supp.dyn[k].pre_room === invtypecode)) {
                        if (matching_amount === undefined) {
                            matching_amount = 0.0;
                        }
                        matching_amount += merged_supp.dyn[k].amount;
                    }
                }

            } else {
                cost_details.push(round3(0.0) + ' EUR for "' + codes[i] + '" (not applicable due to ALPINEBITSDOW pattern) on ' + dt);
            }

            if (matching_amount != undefined) {

                var am;

                switch (merged_supp.ctc) {

                    // since single stays that occupy more than one room are not supported,
                    // case 1 == case 19 and case 12 == case 18 (intentional fall through)

                    // fn_hash contains as keys all the dates where a free nights discount was
                    // applied, on these dates supplements are waived for the "per day/night" cases

                    case '1':   // daily
                    case '19':  // per room per night
                        if (fn_hash[dt]) {
                            cost_details.push(round3(0.0) + ' EUR for "' + codes[i] + '" (free nights discount applies) on ' + dt);
                        } else {
                            am = matching_amount;
                            cost_details.push(round3(am) + ' EUR for "' + codes[i] + '" on ' + dt);
                            cost_total += am;
                        }
                        break;
                    case '12':  // per stay
                    case '18':  // per room per stay
                        am = matching_amount / stay_nights;
                        cost_details.push(round3(am) + ' EUR for "' + codes[i] +
                            '" which is 1/' + stay_nights + ' of the amount per stay in this period (' + matching_amount + ' EUR) on ' + dt);
                        cost_total += am;
                        break;
                    case '20':  // per person per stay
                        am = matching_amount * stay_pax / stay_nights;
                        cost_details.push(round3(am) + ' EUR for "' + codes[i] +
                            '" which is 1/' + stay_nights + ' of the amount per stay in this period (' + matching_amount + ' EUR) on ' + dt + ' times the guest count (' + stay_pax + ')');
                        cost_total += am;
                        break;
                    case '21':  // per person per night
                        if (fn_hash[dt]) {
                            cost_details.push(round3(0.0) + ' EUR for "' + codes[i] + '" (free nights discount applies) on ' + dt);
                        } else {
                            am = matching_amount * stay_pax;
                            cost_details.push(round3(am) + ' EUR for "' + codes[i] + '" on ' + dt + ' (' + matching_amount + ' EUR) times the guest count (' + stay_pax + ')');
                            cost_total += am;
                        }
                        break;
                    case '24':  // item (assumed to be 1)
                        am = matching_amount;
                        cost_details.push(round3(am) + ' EUR for "' + codes[i] + '" (assuming the item count is 1)');
                        cost_total += am;
                        dt = dep; // exit the while-loop early since the "item" ctc is applied only once
                        break;
                    default:
                        assert(false, 'ChargeTypeCode that should not have passed validation encountered in match_supps()');
                }
            }

            dt = utildate.date_add(dt, 1); // next date to match, but note dt is also assigned inside the switch

        }

    }

    return {cost_details: cost_details, cost_total: Number(round3(cost_total))};

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

function round2(n) {
    return pad(7, String(Number(n).toFixed(2)));
}

function round3(n) {
    return pad(8, String(Number(n).toFixed(3)));
}

function pad(n, s) {
    while (s.length < n) {
        s = ' ' + s;
    }
    return s;
}

function assert(b, msg) {
    if (!b) {
        throw 'assertion failed: ' + msg + ' - this is bug, please report it';
    }
}


var info1_buf;

function info1(str) {
    info1_buf += str + '\n';
}

var info2_buf;

function info2(str) {
    info2_buf += str + '\n';
}
