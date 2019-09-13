var run_counter = 0;
var run = (code) => {
    run_counter += 1;
    var _cb = null;
    var returnPromise = new Promise((resolve, reject) => {
        _cb = resolve;
    });
    // TODO: this wrapping plus a TRY / CATCH should be refactored into a macro
    return Promise.all([eval_cljs("test_" + run_counter, code, {context: {result: _cb}}), returnPromise]).then(
        (asyncValues) => {
            return {exports: asyncValues[0].exports, result: asyncValues[1]};
        });
};
var getResult = (code) => run(code).then(x => x.result);
var getExports = (code) => run(code).then(x => x.exports);

describe("CLJS_EVAL", function() {

  beforeEach(function() {
    // window.cljs_eval.core.clear_cache();
  });

  it("should correctly evaluate simple numeric expressions", async function() {
    expect(await getResult('(js/result (+ 1 2))')).toEqual(3);
  });

  it("can evaluate more complex forms", async function() {
    expect(await getResult(`(js/result (let [x 2
                                             f (fn [y] (* 2 y))]
                                            (do
                                                (+ 2 1)
                                                (* (f 2) x 3))))`)).toEqual(24);
  });

  it("should correctly use host interop", async function() {
    expect(await getResult('(js/result (js/Math.round 0.5))')).toEqual(1);
  });

  
  it("can use defn within code", async function() {
    expect(await getResult(`
        (ns test.simple_defn)
        (defn foo [x] (* 2 x))
        (+ 1 2)
        (js/result (foo 3))
        `)).toEqual(6);
  });

  // note: CLJS compiler bug (as of [org.clojure/clojurescript "1.10.520"])
  // without the (+ 1 2), the compiler produces invalid code when exporting in default NS.
  // this works in dev mode, but cljs.user is factored out by gcc simple optimizations, so this wont compile
  it("can export symbols (default ns)", async function() {
    var result = await run(`
        (def ^:export foo 42)
        (js/result 3)
    `);
    expect(result.exports).toEqual({foo: 42});
    expect(result.result).toEqual(3);
    expect(goog.global.cljs.user.foo).toEqual(42);
  });

  it("can export functions (declared ns)", async function() {
    var result = await run(`
        (ns test.defn_test)
        (defn ^:export foo [x] (* 42 x))
        (js/result)
    `);
    console.log(result);
    expect(result.exports.foo(2)).toEqual(84);
    expect(goog.global.test.defn_test.foo(2)).toEqual(84);
  });



    /*
  it("should correctly export values with def (no ns)", async function() {
    expect(await getExports(run('(def ^:export foobar 4)'))).toEqual({foobar: 4});
  });*/
    /*
// simple export data
test("test4", `
    (ns my.test4)
    (def ^:export foobar [1 2 3 4])
`);
*/



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
