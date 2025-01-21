import { expect, test } from 'vitest';
import { readFileSync } from 'fs';
var engine = require('../../lib/engine');

const path = './tests/lts_kunde_wh/R310651-OF.xml';
// const path = './tests/lts_kunde_wh/R820444-OF.xml'; // <=4 nights
const jobDefault = {
    rpmsg_data: readFileSync(path, 'utf8'),
    arrival: '2025-03-22',
    departure: '2025-03-29',
    num_adults: 2,
    children_ages: [5],
    occupancy: ['B', 1, 2, 3, undefined],
    booking_date: undefined,
    protocol_version: '2018-10'
};

test('#1 match 2 adults and 1 child', () => {
    const outcome = engine.run(jobDefault);

    console.log(outcome);
    // outcome: according to OfferRule restrictions, all guests are considered adults - however, children are present in the stay -> skipping
    expect(outcome.result.B).toBe(595); // 7 * 85
});

test('#2 match 2 adults', () => {
    const job = jobDefault;
    job.children_ages = [];

    const outcome = engine.run(job);

    console.log(outcome);
    expect(outcome.result.B).toBe(525); // 7 * 75
});

test('#3 match 3 adults', () => {
    const job = jobDefault;
    job.num_adults = 3;
    job.children_ages = [];

    const outcome = engine.run(job);

    console.log(outcome);
    expect(outcome.result.B).toBe(595); // 7 * 85
});