/*

 AlpineBits rate plan test application (rtapp-201710)

 (C) 2018-2020 AlpineBits Alliance
 based on previous work (C) 2014-2015 TIS innovation park


 cli.js - a command line interface to the rtapp engine, that prints the total cost of a stay to stdout


 options:

 -r <rate_plans_msg.xml>

 -i
 <code> <min occupancy> <std occupancy> <max occupancy> { <max child occupancy> | undefined }
 [ ... repeated as many times as needed to define inventory occupation for all codes ]

 -a <ISO arrival date>

 -d <ISO departure date>

 -n <number of adults>

 [  -c <child one age> [ <child two age> [...] ] ]

 [ -b <booking_date> ]

 [ -p <protocol_version> ]

 [ -v  | -vv ]


 example usage:

 node cli.js -r sample.xml -i double 2 2 4 undefined -a 2014-03-03 -d 2014-03-08 -n 2 -c 3 15 -v

 notes:

 -v   also prints out the debug output that details how the total cost was calculated
 -vv  is like -v, with even more debug output that dumps the rateplans

 -b <booking_date> is optional and used to test Min/MaxAdvancedBookingOffset, if the date is not
 given the current date is assumed

 -p <protocol_version> is optional and can be either 2017-10 (the default), 2018-10 or 2020-10


 author:

 chris@1006.org

 */


'use strict';


var fs = require('fs');
var engine = require('./lib/engine');


var rpmsg_name, rpmsg_data, arrival, departure, num_adults, children_ages = [], occupancy = [], booking_date, protocol_version;

var show_info1 = false;
var show_info2 = false;

function err_exit(msg) {
    console.log();
    console.error('rtapp/cli.js error: ' + msg);
    console.log();
    process.exit(1);
}

if (process.argv.length <= 2) {
    console.log('usage: node cli.js -r <rate_plans_msg.xml>');
    console.log('                   -i <code> <min occupancy> <std occupancy> <max occupancy> { <max child occupancy> | undefined } [...] ');
    console.log('                   -a <ISO arrival date> ');
    console.log('                   -d <ISO departure date> ');
    console.log('                   -n <number of adults>');
    console.log('                 [ -c <child one age> [ <child two age> [...] ] ]');
    console.log('                 [ -b <booking_date> ]');
    console.log('                 [ -p <protocol_version> ]');
    console.log('                 [ -v  | -vv ]');
    process.exit(0);
}

// step 1/3: parse arguments

var state = '', str, i;

for (i = 2; i < process.argv.length; i++) {
    str = process.argv[i];
    if (str.charAt(0) === '-') {
        switch (str) {      // intentional fall-through
            case '-vv':
                show_info1 = true;
            case '-v':
                show_info2 = true;
            case '-r':
            case '-i':
            case '-a':
            case '-d':
            case '-n':
            case '-c':
            case '-b':
            case '-p':
                state = str;
                break;
            default:
                err_exit('unknown option: ' + str);
        }
    } else {
        switch (state) {
            case '-vv':
                state = undefined;
                break;
            case '-v':
                state = undefined;
                break;
            case '-r':
                rpmsg_name = str;
                state = undefined;
                break;
            case '-i':
                occupancy.push(str);
                break;
            case '-a':
                arrival = str;
                state = undefined;
                break;
            case '-d':
                departure = str;
                state = undefined;
                break;
            case '-n':
                num_adults = str;
                state = undefined;
                break;
            case '-c':
                children_ages.push(str);
                break;
            case '-b':
                booking_date = str;
                break;
            case '-p':
                protocol_version = str;
                break;
            default:
                err_exit('could not parse argument list near token: ' + str);
        }
    }
}

if (rpmsg_name === undefined) {
    err_exit('no rate plans message file was given (-r)');
}
if (occupancy.length === 0) {
    err_exit('no inventory occupancy was given (-i)');
}
if (arrival === undefined) {
    err_exit('no arrival date was given (-a)');
}
if (departure === undefined) {
    err_exit('no departure date was given (-d)');
}
if (num_adults === undefined) {
    err_exit('number of adults was not given (-n)');
}


// step 2/3: load the rate plans message file

try {
    rpmsg_data = fs.readFileSync(rpmsg_name, 'utf8');
} catch (ex) {
    err_exit(ex)
}


//  step 3/3: call the engine and print results

try {

    var ret = engine.run({
        rpmsg_data: rpmsg_data,
        arrival: arrival,
        departure: departure,
        num_adults: num_adults,
        children_ages: children_ages,
        occupancy: occupancy,
        booking_date: booking_date,
        protocol_version: protocol_version
    });

    console.log();

    if (show_info1) {
        console.log(ret.info1);
    }
    if (show_info2) {
        console.log(ret.info2);
    }

    console.log(JSON.stringify(ret.result));

    console.log();

} catch (ex) {

    err_exit(ex);

}
