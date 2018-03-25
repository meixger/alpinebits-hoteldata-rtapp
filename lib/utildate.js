/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park

 utildate.js - a small library to deal with ISO-dates (yyyy-mm-dd)

 author: chris@1006.org

 */

'use strict';


exports.is_valid_date = is_valid_date;
exports.date_between = date_between;
exports.date_interval_overlaps = date_interval_overlaps;
exports.date_add = date_add;
exports.date_diff = date_diff;
exports.date_dow = date_dow;


/**
 * test whether a date is valid
 *
 * @param   {String}    date - date in ISO format ('yyyy-mm-dd')
 *
 * @returns {Boolean}   true if and only if the date is valid
 */
function is_valid_date(date) {
    if (typeof (date) !== 'string') {
        return false;
    }
    var p = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!p) {
        return false;
    }
    var y = Number(p[1]);
    var m = Number(p[2]);
    var d = Number(p[3]);
    if (y < 1 || y > 9999 || m < 1 || m > 12) {
        return false;
    }
    if (d < 1 || d > days_in_month(y, m)) {
        return false;
    }
    return true;
}


/**
 * check if a date is between two other dates
 *
 * @param   {String}    start - start date in ISO format ('yyyy-mm-dd')
 * @param   {String}    end   - end date in ISO format
 * @param   {String}    check - date to check
 *
 * @returns {Boolean}   true if start <= check <= end
 */
function date_between(start, end, check) {
    if (!is_valid_date(start)) {
        throw 'date_between: invalid date (' + start + ')';
    }
    if (!is_valid_date(end)) {
        throw 'date_between: invalid date (' + end + ')';
    }
    if (!is_valid_date(check)) {
        throw 'date_between: invalid date (' + check + ')';
    }
    if (date_diff(start, check) >= 0 && date_diff(check, end) >= 0) {
        return true;
    }
    return false;
}


/**
 * check if two date intervals overlap
 *
 * @param   {String}    a_start - start date in ISO format ('yyyy-mm-dd')
 * @param   {String}    a_end   - end date in ISO format
 * @param   {String}    b_start - start date in ISO format
 * @param   {String}    b_end   - end date in ISO format
 *
 * @returns {Boolean}   true if a and b overlap, false otherwise
 */
function date_interval_overlaps(a_start, a_end, b_start, b_end) {
    if (date_between(a_start, a_end, b_start) || date_between(b_start, b_end, a_start)) {
        return true;
    }
    return false;
}


/**
 * add n days to a date
 *
 * @param   {String}            dt - date in ISO format ('yyyy-mm-dd')
 * @param   {String, Number}    nn - number of days to add (>= 0)
 *
 * @returns {String}            result date
 */
function date_add(dt, nn) {
    if (!is_valid_date(dt)) {
        throw 'date_add: invalid date (' + dt + ')';
    }
    if (!is_non_negative_int(nn)) {
        throw 'date_add: invalid number of days to add (' + nn + ')';
    }
    var n = Number(nn);
    var a = dt.split('-');
    var y = Number(a[0]);
    var m = Number(a[1]);
    var d = Number(a[2]);
    while (n > 0) {
        if (d < days_in_month(y, m)) {
            d++;
        } else if (m < 12) {
            d = 1;
            m++;
        } else if (y < 9999) {
            d = 1;
            m = 1;
            y++;
        } else {
            throw 'date_add: date out of range';
        }
        n--;
    }
    return zeropad(y, 4) + '-' + zeropad(m, 2) + '-' + zeropad(d, 2);
}


/**
 * compute the difference in days between two dates
 *
 * @param   {String}    start - start date in ISO format ('yyyy-mm-dd')
 * @param   {String}    end   - end date in ISO format
 *
 * @returns {Number}    integer difference in days between the two dates
 */
function date_diff(start, end) {

    if (!is_valid_date(start)) {
        throw 'date_diff: invalid date (' + start + ')';
    }
    if (!is_valid_date(end)) {
        throw 'date_diff: invalid date (' + end + ')';
    }

    var sa = start.split('-');
    var sy = Number(sa[0]);
    var sm = Number(sa[1]);
    var sd = Number(sa[2]);
    var ea = end.split('-');
    var ey = Number(ea[0]);
    var em = Number(ea[1]);
    var ed = Number(ea[2]);

    var delta;
    if (ey > sy) {
        delta = 1;
    } else if (ey < sy) {
        delta = -1;
    } else if (em > sm) {
        delta = 1;
    } else if (em < sm) {
        delta = -1;
    } else {
        return ed - sd;
    }

    var y = sy;
    var m = sm;
    var diff = 0;

    if (delta === 1) {
        diff = days_in_month(y, m) - sd;
    } else {
        diff = -sd;
    }
    while (true) {
        m = m + delta;
        if (m === 0) {
            y--;
            m = 12;
        } else if (m === 13) {
            y++;
            m = 1;
        }
        if (y === ey && m === em) {
            break;
        }
        diff += delta * days_in_month(y, m);

    }
    if (delta === 1) {
        diff += ed;
    } else {
        diff -= days_in_month(y, m) - ed;
    }
    return diff;
}


/**
 * compute the day of week (dow) from a date
 *
 * @param   {String}    date - date in ISO format ('yyyy-mm-dd')
 *
 * @returns {Number}    integer indicating the dow: 0 (Sunday) ... 6 (Saturday)
 */
function date_dow(date) {

    // algo from http://de.wikipedia.org/wiki/Wochentagsberechnung

    if (!is_valid_date(date)) {
        throw 'date_dow: invalid date (' + date + ')';
    }

    var a = date.split('-');
    var d = Number(a[2]);                      // day
    var m = Number(a[1]);                      // month
    var cc = Math.floor(Number(a[0]) / 100);    // two-digit century
    var yy = Number(a[0]) % 100;                // two-digit year

    // contribution from d

    var nd = d % 7;

    // contribution from m

    var nm_lut = [0, 0, 3, 3, 6, 1, 4, 6, 2, 5, 0, 3, 5];
    var nm = nm_lut[m];

    // contribution from yy

    var nyy = (yy + Math.floor(yy / 4)) % 7;

    // contribution from cc

    var ncc = (3 - cc % 4) * 2;

    // correction for leap years (only if m == 1 or m == 2)

    var nleap = 0;
    if (m <= 2 && days_in_month(cc * 100 + yy, 2) === 29) {
        nleap = -1;
    }

    // final sum

    return (nd + nm + ncc + nyy + nleap) % 7;

}


/* private functions */

function days_in_month(y, m) {
    var maxmdays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m !== 2) {
        return maxmdays[m];
    }
    if (y % 400 === 0) {
        return 29;
    }
    if (y % 100 === 0) {
        return 28;
    }
    if (y % 4 === 0) {
        return 29;
    }
    return 28;
}

function zeropad(num, digits) {
    var str = String(num);
    while (str.length < digits) {
        str = '0' + str;
    }
    return str;
}

function is_non_negative_int(a) {

    var s = String(a);
    var p = s.match(/^\d+$/);
    if (!p) {
        return false;
    }
    return true;
}
