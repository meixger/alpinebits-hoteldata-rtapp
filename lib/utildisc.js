/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 utildisc.js - a set of functions to deal with AlpineBits Discount elements (stored as xm2js - JS objects)

 author: chris@1006.org

 */

'use strict';


exports.get_discount = get_discount;


/**
 *  get data about discounts in the given rate plan
 *
 * @param   {Object}    rpel - a RatePlan element
 *
 * @returns {Object}    an object with fields: restrictions (object),
 *                                             type_free_nights (boolean), maxage, mincnt, lastqp,
 *                                             type_family (boolean), maxage, mincnt and freecnt
 * @throws  {String}    in case of validation errors
 */
function get_discount(rpel) {


    var i, j;
    var ret = {type_free_nights: false, type_family: false, restrictions: {}};

    var offers = rpel.Offers;
    if (offers === undefined || offers.length != 1) {
        throw 'invalid RatePlan: must contain exactly one Offers element';
    }
    var offer = offers[0].Offer;


    // restriction -----------------------------------------------------------------------------------------------------

    // there must be at least one Offer element used for restrictions and it must be the first
    // Offer element (it has NO Discount or Guest sub-element)

    if (offer === undefined || offer.length < 1) {
        throw 'invalid RatePlan: at least one Offer element must be present';
    }

    if (offer[0].Discount !== undefined) {
        throw 'invalid RatePlan: the first Offer element must not contain a Discount element';
    }

    if (offer[0].Guest !== undefined) {
        throw 'invalid RatePlan: the first Offer element must not contain a Guest element';
    }

    var rules = offer[0].OfferRules;

    if (rules === undefined || rules.length !== 1) {
        throw 'invalid first Offer element: must contain exactly one OfferRules element';
    }

    var rule = rules[0].OfferRule;
    if (rule === undefined || rule.length !== 1) {
        throw 'invalid first Offer element: must contain exactly one OfferRule element';
    }
    rule = rule[0];

    // restriction -> min_los/max_los

    var stays, stay;

    ret.restrictions.min_los = undefined; // default undefined (= unlimited)
    ret.restrictions.max_los = undefined;

    stays = rule.LengthsOfStay;
    if (stays) {
        if (stays.length > 1) {
            throw 'invalid first Offer element: OfferRule has more than one LengthsOfStay elements';
        }
        stay = stays[0].LengthOfStay;
    }

    if (stay) {
        for (i = 0; i < stay.length; i++) {
            if (stay[i].$ === undefined) {
                throw 'invalid first Offer element: LengthOfStay element has no attributes';
            }
            var stay_t = stay[i].$.Time;
            var stay_tu = stay[i].$.TimeUnit;
            var stay_mmt = stay[i].$.MinMaxMessageType;
            if (!is_non_negative_int(stay_t)) {
                throw 'invalid first Offer element: LengthOfStay has invalid or missing Time attribute';
            }
            if (stay_tu !== 'Day') {
                throw 'invalid first Offer element: LengthOfStay has  invalid or missing TimeUnit attribute';
            }
            if (stay_mmt === 'SetMinLOS') {
                if (ret.restrictions.min_los === undefined) {
                    ret.restrictions.min_los = Number(stay_t);
                } else {
                    throw 'invalid first Offer element: LengthOfStay has more than one LengthOfStay of type "SetMinLOS"';
                }
            } else if (stay_mmt === 'SetMaxLOS') {
                if (ret.restrictions.max_los === undefined) {
                    ret.restrictions.max_los = Number(stay_t);
                } else {
                    throw 'invalid first Offer element: LengthOfStay has more than one LengthOfStay of type "SetMaxLOS"';
                }
            } else {
                throw 'invalid first Offer element: LengthOfStay has invalid or missing value for attribute MinMaxMessageType';
            }
        }
        if (ret.restrictions.min_los !== undefined && ret.restrictions.max_los !== undefined && ret.restrictions.min_los > ret.restrictions.max_los) {
            throw 'invalid first Offer element: OfferRule has inconsistent LengthOfStay values: min value > max value';
        }
    }

    // restriction -> arrival_dow/departure_dow

    var dows, adow, ddow;
    var days = ['Sun', 'Mon', 'Tue', 'Weds', 'Thur', 'Fri', 'Sat'];

    ret.restrictions.arrival_dow = [true, true, true, true, true, true, true];    // default: allow
    ret.restrictions.departure_dow = [true, true, true, true, true, true, true];

    dows = rule.DOW_Restrictions;
    if (dows) {
        if (dows.length > 1) {
            throw 'invalid first Offer element: OfferRule has more than one DOW_Restrictions elements';
        }
        adow = dows[0].ArrivalDaysOfWeek;
        ddow = dows[0].DepartureDaysOfWeek;
    }

    if (adow) {
        if (adow.length > 1) {
            throw 'invalid first Offer element: OfferRule has more than one ArrivalDaysOfWeek elements';
        }
        adow = adow[0];
        for (i = 0; i < days.length; i++) {
            if (adow.$ !== undefined && adow.$[days[i]]) {
                if ((adow.$[days[i]]).match(/^(1|true)$/i)) {
                    ret.restrictions.arrival_dow[i] = true;
                } else if ((adow.$[days[i]]).match(/^(0|false)$/i)) {
                    ret.restrictions.arrival_dow[i] = false;
                } else {
                    throw 'invalid first Offer element: ArrivalDaysOfWeek has invalid week day attribute value';
                }
            }
        }
    }

    if (ddow) {
        if (ddow.length > 1) {
            throw 'invalid first Offer element: OfferRule has more than one DepartureDaysOfWeek elements';
        }
        ddow = ddow[0];
        for (i = 0; i < days.length; i++) {
            if (ddow.$ !== undefined && ddow.$[days[i]]) {
                if ((ddow.$[days[i]]).match(/^(1|true)$/i)) {
                    ret.restrictions.departure_dow[i] = true;
                } else if ((ddow.$[days[i]]).match(/^(0|false)$/i)) {
                    ret.restrictions.departure_dow[i] = false;
                } else {
                    throw 'invalid first Offer element: DepartureDaysOfWeek has invalid week day attribute value';
                }
            }
        }
    }

    // restriction -> occupancy

    var occupancy = rule.Occupancy;

    if (occupancy === undefined || occupancy.length < 1 || occupancy.length > 2) {
        throw 'invalid first Offer element: OfferRule must have one or two Occupancy elements';
    }

    var adult_seen = false;
    var adult_minage;
    var adult_minocc;
    var adult_maxocc;

    var child_seen = false;
    var child_minage;
    var child_maxage;
    var child_minocc;
    var child_maxocc;

    var ageq, minage, maxage, minocc, maxocc;

    for (i = 0; i < occupancy.length; i++) {

        if (occupancy[i].$ === undefined) {
            throw 'invalid first Offer element: Occupancy element has no attributes';
        }
        ageq   = occupancy[i].$.AgeQualifyingCode;
        minage = occupancy[i].$.MinAge;
        maxage = occupancy[i].$.MaxAge;
        minocc = occupancy[i].$.MinOccupancy;
        maxocc = occupancy[i].$.MaxOccupancy;

        if (ageq === '10') {
            if (adult_seen) {
                throw 'invalid first Offer element: repeated Occupancy element with attribute AgeQualifyingCode="10"';
            }
            if (maxage !== undefined) {
                throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="10" must not have a MaxAge attribute';
            }
            if (minage !== undefined) {
                if (!(is_positive_int(minage) && Number(minage) <= 18)) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="10": if present, MinAge must be a positive integer <= 18';
                }
                adult_minage = Number(minage);
            }
            if (minocc !== undefined) {
                if (!(is_positive_int(minocc) && minocc <= 99) ) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="10": if present, MinOccupancy must be a positive integer <= 99';
                }
                adult_minocc = Number(minocc);
            }
            if (maxocc !== undefined) {
                if (!(is_positive_int(maxocc) && maxocc <= 99) ) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="10": if present, MaxOccupancy must be a positive integer <= 99';
                }
                adult_maxocc = Number(maxocc);
            }
            if (minocc !== undefined && maxocc !== undefined && minocc > maxocc) {
                throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="10": inconsistent values for MinOccupancy and MaxOccupancy';
            }
            adult_seen = true;
        }

        if (ageq === '8') {
            if (child_seen) {
                throw 'invalid first Offer element: repeated Occupancy element with attribute AgeQualifyingCode="8"';
            }
            if (minage !== undefined) {
                if (!(is_positive_int(minage) && Number(minage) <= 18)) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": if present, MinAge must be a positive integer <= 18';
                }
                child_minage = Number(minage);
            }
            if (maxage !== undefined) {
                if (!(is_positive_int(maxage) && Number(maxage) <= 18)) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": if present, MaxAge must be a positive integer <= 18';
                }
                child_maxage = Number(maxage);
            }
            if (child_minage !== undefined && child_maxage !== undefined && child_minage >= child_maxage) {
                throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": inconsistent values for MinAge and MaxAge';
            }
            if (minocc !== undefined) {
                if (!(is_positive_int(minocc) && minocc <= 99) ) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": if present, MinOccupancy must be a positive integer <= 99';
                }
                child_minocc = Number(minocc);
            }
            if (maxocc !== undefined) {
                if (!(is_positive_int(maxocc) && maxocc <= 99) ) {
                    throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": if present, MaxOccupancy must be a positive integer <= 99';
                }
                child_maxocc = Number(maxocc);
            }
            if (minocc !== undefined && maxocc !== undefined && minocc > maxocc) {
                throw 'invalid first Offer element: Occupancy element with attribute AgeQualifyingCode="8": inconsistent values for MinOccupancy and MaxOccupancy';
            }

            child_seen = true;
        }

        if (ageq !== '8' && ageq !== '10') {
            throw 'invalid first Offer element: attribute Occupancy -> AgeQualifyingCode must be "8" or "10"';
        }
    }

    if (!adult_seen) {
        throw 'invalid first Offer element: missing Occupancy element with attribute AgeQualifyingCode="10"';
    }

    if (adult_minage === undefined && child_seen) {
        throw 'invalid first Offer element: the Occupancy element with attribute AgeQualifyingCode="10" has no MinAge attribute, but the one with AgeQualifyingCode="8" is also present';
    }
    if (adult_minage !== undefined && !child_seen) {
        throw 'invalid first Offer element: the Occupancy element with attribute AgeQualifyingCode="10" has a MinAge attribute, but the one with AgeQualifyingCode="8" is not present';
    }
    if (adult_minage !== undefined && child_maxage !== undefined && child_maxage > adult_minage) {
        throw 'invalid first Offer element: the Occupancy element with attribute AgeQualifyingCode="8" has a MaxAge value that is > than the MinAge value for the one with AgeQualifyingCode="10"';
    }
    if (adult_minage !== undefined && child_minage !== undefined && child_minage >= adult_minage) {
        throw 'invalid first Offer element: the Occupancy element with attribute AgeQualifyingCode="8" has a MinAge value that is >= than the MinAge value for the one with AgeQualifyingCode="10"';
    }

    ret.restrictions.adult_minage = adult_minage;
    ret.restrictions.adult_minocc = adult_minocc;
    ret.restrictions.adult_maxocc = adult_maxocc;

    ret.restrictions.child_seen   = child_seen;
    ret.restrictions.child_minage = child_minage;
    ret.restrictions.child_maxage = child_maxage;
    ret.restrictions.child_minocc = child_minocc;
    ret.restrictions.child_maxocc = child_maxocc;


    // free nights and family ------------------------------------------------------------------------------------------

    // following are 0, 1 or 2 more Offer elements:
    // at most 1 with a discount of type "free nights" and at most 1 with a discount of type "family"

    var disc;
    var perc, nreq, ndis, patt;
    var ageqcd, maxage, mincnt, firstp, lastqp;

    for (i = 1; i < offer.length; i++) {

        disc = offer[i].Discount;

        if (!disc) {
            throw 'invalid Offer: no Discount element';
        }
        if (disc.length > 1) {
            throw 'invalid Offer: more than one Discount element';
        }

        if (disc[0].$ === undefined) {
            throw 'invalid Offer: Discount element has no attributes';

        }
        perc = disc[0].$.Percent;
        nreq = disc[0].$.NightsRequired;
        ndis = disc[0].$.NightsDiscounted;
        patt = disc[0].$.DiscountPattern;

        if (perc !== '100') {
            throw 'invalid Offer: missing or invalid Percent attribute in Discount element';
        }

        if (!nreq && !ndis && !patt) {

            // this looks like a family offer

            var guests = offer[i].Guests;
            if (!guests) {
                throw 'invalid Offer: missing Guests element';
            }
            if (guests.length > 1) {
                throw 'invalid Offer: more than one Guests element';
            }
            var guest = guests[0].Guest;
            if (!guest) {
                throw 'invalid Offer: missing Guest element';
            }
            if (guest.length > 1) {
                throw 'invalid Offer: more than one Guest element';
            }

            ageqcd = guest[0].$.AgeQualifyingCode;
            maxage = guest[0].$.MaxAge;
            mincnt = guest[0].$.MinCount;
            firstp = guest[0].$.FirstQualifyingPosition;
            lastqp = guest[0].$.LastQualifyingPosition;

            if (ageqcd !== '8') {
                throw 'invalid Offer: invalid value for AgeQualifyingCode';
            }
            if (!maxage || !is_positive_int(maxage)) {
                throw 'invalid Offer: missing or invalid MaxAge attribute';
            }
            if (!mincnt || !is_non_negative_int(mincnt)) {
                throw 'invalid Offer: missing or invalid MinCount attribute';
            }
            if (firstp !== '1') {
                throw 'invalid Offer: invalid value for FirstQualifyingPosition';
            }
            if (!lastqp || !is_positive_int(lastqp)) {
                throw 'invalid Offer: missing or invalid LastQualifyingPosition';
            }
            if (lastqp > mincnt) {
                throw 'invalid Offer: LastQualifyingPosition cannot exceeed MinCount';
            }
            if (ret.type_family) {
                throw 'invalid Offer: more than one discounts of type "family" detected';
            }
            ret.type_family = true;
            ret.maxage = maxage;
            ret.mincnt = mincnt;
            ret.freecnt = lastqp;

        } else if (nreq && ndis) {

            // this looks like a free nights offer

            if (!is_positive_int(nreq) || nreq > 365) {
                throw 'invalid Offer: invalid value for NightsRequired';
            }
            if (!is_positive_int(ndis) || ndis > 365) {
                throw 'invalid Offer: invalid value for NightsDiscounted';
            }
            if (patt !== undefined) {
                var testpatt = '';
                for (j = 0; j < nreq - ndis; j++) {
                    testpatt += '0';
                }
                for (j = 0; j < ndis; j++) {
                    testpatt += '1';
                }
                if (testpatt !== patt) {
                    throw 'invalid Offer: inconsistent values for NightsRequired, NightsDiscounted and DiscountPattern';
                }
            }
            if (ndis > nreq) {
                throw 'invalid Offer: NightsDiscounted cannot exceed NightsRequired';
            }
            if (ret.type_free_nights) {
                throw 'invalid Offer: more than one discounts of type "free nights" detected';
            }

            ret.type_free_nights = true;
            ret.nreq = nreq;
            ret.ndis = ndis;
            ret.patt = patt;

        } else {
            throw 'invalid Offer: type of discount cannot be determined from the attributes of the Discount element';
        }

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

function is_positive_int(a) {

    if (is_non_negative_int(a) && a > 0) {
        return true;
    }
    return false;
}