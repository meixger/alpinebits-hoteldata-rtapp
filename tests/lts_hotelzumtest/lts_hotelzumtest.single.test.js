import { expect, test } from 'vitest'
import { readFileSync } from 'fs'
var engine = require('../../lib/engine');

// const path = './tests/lts_hotelzumtest/R96748-UF.xml';
// <Occupancy AgeQualifyingCode="10" />
// children doesn't match at all

// const path = './tests/lts_hotelzumtest/R46401-UF.xml';
// <Occupancy AgeQualifyingCode="10" MinAge="10" />
// <Occupancy AgeQualifyingCode="8" />
// children age 15 doesn't match

const path = './tests/lts_hotelzumtest/R79758-UF.xml';
// <Occupancy AgeQualifyingCode="10" MinAge="18" />
// <Occupancy AgeQualifyingCode="8" />
// children matching

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

test('2 adults, 1 child age 5', () => {
    const job = jobDefault;
    const outcome = engine.run(job);
    console.log(outcome.result.B);
    expect(outcome.result.B).toBe(1050);
});

test('2 adults, 1 child age 15', () => {
    const job = jobDefault;
    job.children_ages = [15];
    const outcome = engine.run(job);

    expect(outcome.result.B).toBe(1050);
});

test('2 adults', () => {
    const job = jobDefault;
    job.children_ages = [];
    const outcome = engine.run(job);
    expect(outcome.result.B).toBe(700);
});

test('3 adults', () => {
    const job = jobDefault;
    job.num_adults = 3;
    job.children_ages = [];
    const outcome = engine.run(job);
    expect(outcome.result.B).toBe(1050);
});
