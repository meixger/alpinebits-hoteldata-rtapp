import { expect, describe, test } from 'vitest'
import { readFileSync } from 'fs'
var engine = require('../../lib/engine');

const jobDefault = {
    // rpmsg_data: readFileSync(path, 'utf8'),
    arrival: '2025-03-22',
    departure: '2025-03-29',
    // num_adults: 2,
    // children_ages: [5],
    occupancy: ['B', 1, 2, 3, undefined],
    booking_date: undefined,
    protocol_version: '2018-10'
};

const cases = [
    // <Occupancy AgeQualifyingCode="10" />
    { title: '2 adults           ', ratePlan: 'R96748-UF', num_adults: 2, children_ages: [], expected: 700 },
    { title: '3 adults           ', ratePlan: 'R96748-UF', num_adults: 3, children_ages: [], expected: 1050 },
    { title: '2 adults 1 child 5 ', ratePlan: 'R96748-UF', num_adults: 2, children_ages: [5], expected: 1050 },
    { title: '2 adults 1 child 15', ratePlan: 'R96748-UF', num_adults: 2, children_ages: [15], expected: 1050 },

    // <Occupancy AgeQualifyingCode="10" MinAge="10" /><Occupancy AgeQualifyingCode="8" />
    { title: '2 adults           ', ratePlan: 'R46401-UF', num_adults: 2, children_ages: [], expected: 700 },
    { title: '3 adults           ', ratePlan: 'R46401-UF', num_adults: 3, children_ages: [], expected: 1050 },
    { title: '2 adults 1 child  5', ratePlan: 'R46401-UF', num_adults: 2, children_ages: [5], expected: 1050 },
    { title: '2 adults 1 child 15', ratePlan: 'R46401-UF', num_adults: 2, children_ages: [15], expected: 1050 },

    // <Occupancy AgeQualifyingCode="10" MinAge="18" /><Occupancy AgeQualifyingCode="8" />
    { title: '2 adults          ', ratePlan: 'R79758-UF', num_adults: 2, children_ages: [], expected: 700 },
    { title: '3 adults          ', ratePlan: 'R79758-UF', num_adults: 3, children_ages: [], expected: 1050 },
    { title: '2 adults 1 child  5', ratePlan: 'R79758-UF', num_adults: 2, children_ages: [5], expected: 1050 },
    { title: '2 adults 1 child 15', ratePlan: 'R79758-UF', num_adults: 2, children_ages: [15], expected: 1050 },
];

describe.each(cases)('$ratePlan $title', ({ ratePlan, num_adults, children_ages, expected }) => {
    test(`${num_adults} adults and ${children_ages.length} children (${children_ages}) expected ${expected}`, () => {
        const job = jobDefault;
        job.rpmsg_data = readFileSync(`./tests/lts_hotelzumtest/${ratePlan}.xml`, 'utf8');
        job.num_adults = num_adults;
        job.children_ages = children_ages;
        const outcome = engine.run(job);
        expect(outcome.result.B).toBe(expected);
    });
});
