var customLogger = {
    log: (x) => console.log("customLogger " + x),
    info: (x) => console.info("customLogger " + x),
    warn: (x) => console.warn("customLogger " + x),
    error: (x) => console.error("customLogger " + x)
};

var dummySourceLoader = (ns_id, cb) => {
    // this will be the method to load cljs source from tiddlers
    // console.log("trying to load source for", ns_id);
    if (ns_id.name === 'my.math') {
        cb({filename: "my/math.clj",
            source: ns_id.macros ? "(ns my.math) (defmacro triple [x] (* 3 x))" : "(ns my.math) (defn myfunc [x y] (+ (* x y) (* 3 x)))"});
    } else {
        throw new Error("CLJS sourceLoader: no source for " + ns_id.name);
        //cb(null);
    }
};

var simplerun = (code, sourceLoader) => {
    run_counter += 1;
    var _cb = null;
    var returnPromise = new Promise((resolve, reject) => {
        _cb = resolve;
    });
    return Promise.all([goog.global.cljs_standalone.compiler.eval(
        "test_" + run_counter,
        code, 
        {
            logger: customLogger,
            source_loader: sourceLoader || dummySourceLoader,
            context: {
                result: _cb
            }
        }), returnPromise]).then(
            (asyncValues) => {
                return {exports: asyncValues[0], result: asyncValues[1]};
        });
};


var run_counter = 0;
var run = (code, sourceLoader) => {
    run_counter += 1;
    var _cb = null;
    var returnPromise = new Promise((resolve, reject) => {
        _cb = resolve;
    });
    return Promise.all([goog.global.cljs_standalone.compiler.eval(
        "test_" + run_counter,
        code, 
        {
            logger: customLogger,
            source_loader: sourceLoader || dummySourceLoader,
            context: {
                result: _cb
            }
        }), returnPromise]).then(
            (asyncValues) => {
                return {exports: asyncValues[0], result: asyncValues[1]};
        });
};

var simplerun = (code, sourceLoader) => {
    run_counter += 1;
    var _cb = null;
    return goog.global.cljs_standalone.compiler.eval(
        "test_" + run_counter,
        code, 
        {
            logger: customLogger,
            source_loader: sourceLoader || dummySourceLoader
        });
};


var getResult = (code, sourceLoader) => run(code, sourceLoader).then(x => x.result);
var getExports = (code, sourceLoader) => run(code, sourceLoader).then(x => x.exports);

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
        (ns test.simple-defn)
        (defn foo [x] (* 2 x))
        (+ 1 2)
        (js/result (foo 3))
        `)).toEqual(6);
  });

  // this works in dev mode, but cljs.user is factored out by gcc simple optimizations, so this wont compile
  it("exported symbols not in exports object without  namespace declaration", async function() {
    var result = await run(`
        (def ^:export foo 42)
        (js/result 3)
    `);
    expect(result.exports).toEqual({});
    expect(result.result).toEqual(3);
    expect(goog.global.cljs.user.foo).toEqual(42);
  });

  it("exported symbols appear in exports if namespace declared", async function() {
    var result = await run(`
        (ns test.export-test)
        (def ^:export foo 42)
        (js/result 3)
    `);
    expect(result.exports).toEqual({foo: 42});
    expect(result.result).toEqual(3);
    expect(goog.global.test.export_test.foo).toEqual(42);
  });


  it("name munging works as exptected", async function() {
    var result = await run(`
        (ns test.munged-ns-name)
        (defn ^:export foo-bar [x] (* 42 x))
        (js/result)
    `);
    expect(result.exports.foo_bar(2)).toEqual(84);
    expect(goog.global.test.munged_ns_name.foo_bar(2)).toEqual(84);
  });

    
  it("can export multi-arity functions", async function() {
    var exports = await getExports(`
        (ns test.defn-multi-arity)
        (defn ^:export greet
          ([] (greet "you"))
          ([name] (str "Hello " name)))
        (js/result (greet "x"))
    `);
    expect(Object.keys(exports)).toEqual(["greet"]);
    expect(goog.global.test.defn_multi_arity.greet()).toEqual("Hello you");
    expect(goog.global.test.defn_multi_arity.greet("y")).toEqual("Hello y");
  });

  it("reader conditionals", async function() {
    expect(await getResult(`
        (js/result #?(:clj  0
                       :cljs 1))
        `)).toEqual(1);
  });

  it("simple require-macro", async function() {
    expect(await getResult(`
        (ns my.test1 (:require-macros my.math))
        (js/result (my.math/triple 5))
    `, dummySourceLoader)).toEqual(15);
  });

  it("simple require (function)", async function() {
    expect(await getResult(`
        (ns my.test2 (:require [my.math :as my-math-alias]))
        (js/result (my-math-alias/myfunc 5 6))`,
        dummySourceLoader)).toEqual(45);
  });

  it("can properly handle multiple namespace in single source file", async function() {
    var exports = await getExports(`
    (ns my.test6a)
    (defn ^:export foobar1 [x] (do
        (+ 1 (* 3 x))))
    (ns my.test6b)
    (defn ^:export foobar2 [x] (do
        (+ 2 (* 5 x))))
    (js/result)
    `);
    expect(Object.keys(exports)).toEqual(["foobar1", "foobar2"]);
    expect(goog.global.my.test6a.foobar1(3)).toEqual(10);
    expect(goog.global.my.test6b.foobar2(4)).toEqual(22);
    expect(goog.global.my.test6a.foobar2).toEqual(undefined);
    expect(goog.global.my.test6b.foobar1).toEqual(undefined);
  });

  it("defmacro test (no macro-require)", async function() {
    await run(`
        (ns my.macrotesta$macros)
        (defmacro mymacro [x]
            \`(* 2 ~x))
        (js/result)
    `);
    expect(await getResult(`
        (ns my.macrotestb )
        (defn mt [x] 
            (clj->js [(my.macrotesta/mymacro 5),
                      (str
                          (macroexpand '(my.macrotesta/mymacro 5)))]))
        (js/result (mt 3))
    `)).toEqual([10, '(js* "(~{} * ~{})" 2 5)']);
  });

  it("defmacro test (with macro-require)", async function() {
    await simplerun(`
        (ns my.macrotesta2$macros)
        (defmacro mymacro [x]
            \`(* 2 ~x))
    `);
    expect(await getResult(`
        (ns my.macrotestb2 (:require-macros my.macrotesta2))
        (defn mt [x] 
            (clj->js [(my.macrotesta2/mymacro 5),
                      (str
                          (macroexpand '(my.macrotesta2/mymacro 5)))]))
        (js/result (mt 3))
    `)).toEqual([10, '(js* "(~{} * ~{})" 2 5)']);
  });

  it("transitive require (non-macro)", async function() {
    var sources = {
        'my.transitive-deps1': {
            filename: "my/transitive_deps1.cljs",
            source: `
                (ns my.transitive-deps1
                    (:require [my.transitive-deps2 :as d2]))
                (defn myfunc [s]
                    (-> s
                        (str "b")
                        d2/myfunc
                    ))
            `},
        'my.transitive-deps2': {
            filename: "my/transitive_deps2.cljs",
            source: `
                (ns my.transitive-deps2
                    (:require [my.transitive-deps3 :as d3]))
                (defn myfunc [s]
                    (-> s
                        (str "c")
                        d3/myfunc
                    ))
            `},
        'my.transitive-deps3': {
            filename: "my/transitive_deps3.cljs",
            source: `
                (ns my.transitive-deps3)
                (defn myfunc [s] (str s "d"))
            `}
    };
      
    var sourceLoader = (ns_id, cb) => {
        cb(sources[ns_id.name]);
    }

    expect(await getResult(`
        (ns my.transitive-deps0 (:require [my.transitive-deps1 :as d1]))
        (js/result (d1/myfunc "a"))`,
        sourceLoader)).toEqual("abcd");
  });

  it("transitive require 2 (non-macro)", async function() {
    var sources = {
        'my.transitive-deps21': {
            filename: "my/transitive_deps21.cljs",
            source: `
                (ns my.transitive-deps21
                    (:require [my.transitive-deps22 :as d2]
                              [my.transitive-deps23 :as d3]))
                (defn myfunc [s]
                    (-> s
                        (str "b")
                        d2/myfunc
                        d3/myfunc
                    ))
            `},
        'my.transitive-deps22': {
            filename: "my/transitive_deps22.cljs",
            source: `
                (ns my.transitive-deps22)
                (defn myfunc [s] (str s "c"))
            `},
        'my.transitive-deps23': {
            filename: "my/transitive_deps23.cljs",
            source: `
                (ns my.transitive-deps23)
                (defn myfunc [s] (str s "d"))
            `}
    };
      
    var sourceLoader = (ns_id, cb) => {
        cb(sources[ns_id.name]);
    }

    expect(await getResult(`
        (ns my.transitive-deps20 (:require [my.transitive-deps21 :as d1]))
        (js/result (d1/myfunc "a"))`,
        sourceLoader)).toEqual("abcd");
  });


  it("clear cache", async function() {
    await simplerun(`
        (ns my.cachetest1)
        (defn myfunc [x]
            (* 2 x))
    `);
    expect(goog.global.cljs_standalone.compiler.dump_cache().length > 50).toEqual(true);
    goog.global.cljs_standalone.compiler.clear_cache()
    expect(goog.global.cljs_standalone.compiler.dump_cache()).toEqual('["^ "]');
    // verify compilation still works.
    expect(await getResult(`
        (ns my.cachetest1a)
        (defn foo [x] (* 2 x))
        (+ 1 2)
        (js/result (foo 3))
        `)).toEqual(6);
  });

  it("load cache", async function() {
    await simplerun(`
        (ns my.cachetest3)
        (defn myfunc [x]
            (* 2 x))
    `);
    var script = `
      (ns my.cachetest4 (:require [my.cachetest3 :as c3]))
      (js/result (c3/myfunc 2))
    `;
    var dumpedCache = goog.global.cljs_standalone.compiler.dump_cache();
    goog.global.cljs_standalone.compiler.clear_cache();
    // TODO: verify compile error
    await getResult(script).then(
        () => Promise.reject("compilation should fail with empty cache and no source loader"),
        () => {});
    goog.global.cljs_standalone.compiler.load_cache(dumpedCache);
    expect(await getResult(script)).toEqual(4);
  });


}); // close describe()
