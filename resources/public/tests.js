var run_counter = 0;
var run = (code) => {
    run_counter += 1;
    return eval_cljs("test_" + run_counter, code);
};
var getResult = (p) => p.then(x => x.result);

describe("CLJS_EVAL", function() {

  beforeEach(function() {
    window.cljs_eval.core.clear_cache()
  });

  it("should correctly evaluate simple numeric expressions", async function() {
    expect(await getResult(run('(+ 1 2)'))).toEqual(3);
  });

});

/*
var test = (filename, code) => {
    // TODO assertions
    return eval_cljs(filename, code);
};

var run = () => {

// simple require-macro
test("test1", `
    (ns my.test1 (:require-macros my.math))
    (println (my.math/triple 5))
`);


// simple require-function
test("test2", `
    (ns my.test2 (:require [my.math :as my-math-alias]))
    (println (my-math-alias/myfunc 5 6))
`);


// simple export function 
test("test3", `
    (ns my.test3)
    (defn ^:export foobar [x] (+ 1 (* 3 x)))
`);

// simple export data
test("test4", `
    (ns my.test4)
    (def ^:export foobar [1 2 3 4])
`);

// simple call to host js method
test("test5", `
    (ns my.test5)
    (defn ^:export foobar [x] (do
        (js/console.log (str x))
        (+ 1 (* 3 x))))
`);

// multi-ns test:
test("test6", `
    (ns my.test6a)
    (defn ^:export foobar1 [x] (do
        (js/console.log (str x))
        (+ 1 (* 3 x))))
    (ns my.test6b)
    (defn ^:export foobar2 [x] (do
        (js/console.log (str x))
        (+ 2 (* 5 x))))
`);

// using standard macros
test("test7", `
    (ns my.test7)
    (def a (-> {} (assoc :a 1)))
`);

// defmacro test
test("test8", `
    (ns my.test8)
    (defmacro clog [x] \`(js/console.log ~x))
    (clog "asdf")
`);

// require test
test("test9pre", `
    (ns my.test9pre)
    (defn somefn[x] (* 400 x))
`);
test("test9main", `
    (ns my.test9main (:require my.test9pre))
    (println (my.test9pre/somefn 3))
`);

// macro and non-macro in the same ns
// the result is a single non-macro NS (no $macros suffix)
// proper macro namespaces (ending w/ $macros) are created by
// :refer-macros (this can happen during AOT compilation).
test("test10", `
    (ns my.test10)
    (defmacro triplem [x] (* 3 x))
    (defn triplef [x] (* 3 x))
`);

};*/
