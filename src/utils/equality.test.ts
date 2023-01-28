import { isSubsetEqual } from "./equality";

describe("(partial) object equality", () => {
  test("equality works for simple objects", () => {
    // Given two simple objects which are equal on a subset of their properties
    const object1 = { a: 1, b: 2, c: 3, d: 10 };
    const object2 = { a: 1, b: 2, c: 3, d: 20 };

    // when testing them for equality on just a subset of their properties
    // then expect the result to be depending on whether the subset is equal or not
    expect(isSubsetEqual(object1, object2, ["a", "b", "c"])).toBe(true);
    expect(isSubsetEqual(object1, object2, ["b", "c"])).toBe(true);
    expect(isSubsetEqual(object1, object2, ["a", "c"])).toBe(true);
    expect(isSubsetEqual(object1, object2, ["b", "a"])).toBe(true);
    expect(isSubsetEqual(object1, object2, ["b", "c", "d"])).toBe(false);
    expect(isSubsetEqual(object1, object2, ["a", "b", "c", "d"])).toBe(false);
    expect(isSubsetEqual(object1, object2, ["b", "d"])).toBe(false);
  });
});
