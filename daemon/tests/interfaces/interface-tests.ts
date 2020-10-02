import { expect } from 'chai'; // test library
import * as mocha from 'mocha'; // import types for mocha e.g. describe
import * as ut from '../../src/interfaces/core';


// Example objects (test fixtures)


 // need to explicitly use mocha prefix once or the dependency gets wrongly cleaned up
mocha.describe('Basic typeguards', () => {
    describe('JSON Handling', () => {
        // Test fixture for JSON object handling
        const exampleJSONObject = {example: ['json', {object: 1}, '---']}

        it('JSON object successfully recognized', () => {
            expect(ut.isJSONObject(exampleJSONObject)).to.be.true;
        });
        it('isJSONObject() returns false for non-object input', () => {
            expect(ut.isJSONObject('string')).to.be.false;
        });
        it('JSON object recognized as serializable', () => {
            expect(ut.isJSONSerializable(exampleJSONObject)).to.be.true;
        });
        it('isJSONSerializable() returns false on non-object input', () => {
            expect(ut.isJSONSerializable("string input")).to.be.false;
        });
        it('JSON object parsed successfully', () => {
            const obj = ut.tryParseJsonObject(JSON.stringify(exampleJSONObject));
            expect(obj).to.deep.equal(exampleJSONObject);
        });
        it('TryParse returns null without throwing on parse failure', () => {
            expect(ut.tryParseJsonObject('This is not json')).to.be.null;
        });
    });
    describe('Object handling', () => {
        it('isObject() returns true on valid object input', () => {
            expect(ut.isObject({name: 'Object', type: 'Object', value: 5})).to.be.true;
        });
        it('isObject() returns false on non-object input', () => {
            expect(ut.isObject('I am a string')).to.be.false;
        })
    });
    describe('String handling', () => {
        it('isString() returns true on string input', () => {
            expect(ut.isString("5")).to.be.true;
        });
        it('isString() returns false on non-string input', () => {
            expect(ut.isString(5)).to.be.false;
        });
    })
    describe('Function handling', () => {
        it('isFunction() returns true on function input', () => {
            expect(ut.isFunction(() => 5)).to.be.true;
        });
        it('isFunction() returns false on non-function input', () => {
            expect(ut.isFunction(5)).to.be.false;
        });
    });
    describe('Number handling', () => {
        it('isNumber() returns true on number input', () => {
            expect(ut.isNumber(5.432)).to.be.true;
            expect(ut.isNumber(-783)).to.be.true;
        });
        it('isNumber() returns false on non-numeric input', () => {
            expect(ut.isNumber('5')).to.be.false;
            expect(ut.isNumber(BigInt(5))).to.be.false;
        });
        it('isBigInt() returns true on bigint input', () => {
            expect(ut.isBigInt(BigInt(5))).to.be.true;
        })
        it('isBigInt() returns false on non-bigint input', () => {
            expect(ut.isBigInt(5)).to.be.false;
        })
    });
    describe('Null handling', () => {
        it('isNull() returns true on null input', () => {
            expect(ut.isNull(null)).to.be.true;
        });
        it('isNull() returns false on non-null input', () => {
            expect(ut.isNull(5)).to.be.false;
        });
    });
    describe('Boolean handling', () => {
        it('isBoolean() returns true on boolean input', () => {
            expect(ut.isBoolean(true)).to.be.true;
            expect(ut.isBoolean(false)).to.be.true;
            expect(ut.isBoolean(5 === 5)).to.be.true;
            expect(ut.isBoolean('a' === 'a')).to.be.true;
        });
        it('isBoolean() returns false on non-boolean input', () => {
            expect(ut.isBoolean('false')).to.be.false;
        });
    })
})

describe('Utility comparisons', () => {
    const checker = ut.isOneOf([ut.isBoolean, ut.isString]);
    describe('Type union', () => {
        it('isOneOf() recognizes all enumerated types', () => {
            expect(checker('I am a string')).to.be.true;
            expect(checker(false)).to.be.true;
        });
        it('isOneOf() returns false on non-included types', () => {
            expect(checker(5)).to.be.false;
        });
    });
    describe('Optional parameters', () => {
        // TODO
    });
    describe('Equality check', () => {
        const isMyString = ut.isEqualTo('myString');
        it('isEqualTo() returns true on equality', () => {
            expect(isMyString('myString')).to.be.true;
        });
        it('isEqualTo() returns false on non-equality', () => {
            expect(isMyString('not my string')).to.be.false;
        });
    });
    describe('Array check', () => {
        const areStrings = ut.isArrayOf(ut.isString);
        it('isArrayOf() returns true on array of specified type', () => {
            expect(areStrings(['These', 'are', 'four', 'strings'])).to.be.true;
        });
        it('isArrayOf() returns false on non-array', () => {
            expect(areStrings('This is not an array')).to.be.false;
        });
        it('isArrayOf() returns false on wrongly-typed members', () => {
            expect(areStrings(['These', 'are', 'not', 5, 'strings'])).to.be.false;
        });
    });
    describe('Object validation to spec', () => {
        // TODO -- see notes in core.ts.
        it('_validateObject() returns false on non-object input', () => {
            expect(ut._validateObject('foo', { x: ut.isBigInt }));
        });
        it('_validateObject() returns false on null input', () => {
            expect(ut._validateObject(null, { x: ut.isBigInt }));
        });
    });

})
