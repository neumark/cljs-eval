var globalGoog = window.goog;
// allow redefinition of namespaces
goog.isProvided_ = (_) => false;
// because of the change above, goog.require
// now throws errors. Since it doesn't do anything
// we can just get rid of it.
goog.require = () => {};

// based on TW5/boot/boot.js
var sandboxedEval = function(code,context) {
	var contextCopy = Object.assign({} ,context);
	// Get the context variables as a pair of arrays of names and values
	var contextNames = [], contextValues = [];
	Object.keys(contextCopy).forEach(function(name) {
		contextNames.push(name);
		contextValues.push(contextCopy[name]);
	});
	// Add the code prologue and epilogue
	code = "(function(" + contextNames.join(",") + ") {(function(){\n" + code + "\n;})();\nreturn exports;\n})\n";
	// Compile the code into a function
	var fn;
        // NOTE: cljs compiler also specifies sourceURL,  need to give this twice (with different values)? harmless if redundant.
		fn = window["eval"](code);
	// Call the function and return the exports
	return fn.apply(null,contextValues);
};

var customLogger = {
    log: (x) => console.log("customLogger " + x),
    info: (x) => console.info("customLogger " + x),
    warn: (x) => console.warn("customLogger " + x),
    error: (x) => console.error("customLogger " + x)
};

var dummySourceLoader = (ns_id, cb) => {
    // this will be the method to load cljs source from tiddlers
    console.log("trying to load source for", ns_id);
    if (ns_id.name === 'my.math') {
        cb({filename: "my/math.clj",
            source: ns_id.macros ? "(ns my.math) (defmacro triple [x] (* 3 x))" : "(ns my.math) (defn myfunc [x y] (+ (* x y) (* 3 x)))"});
    } else {
        throw new Error("no source for " + ns_id.name);
        //cb(null);
    }
};


var compile = (filename, source, options) => {
     return new Promise((resolve, reject) => {
         var extendedOpts = Object.assign({}, options, {on_success: resolve, on_failure: reject, name: filename});
         globalGoog.global.cljs_eval.core.compile(source, extendedOpts);
     });
};

var overrideMethod = function (localGoog, methodName, methodFn, callSuper) {
    localGoog[methodName] = function() {
        methodFn.apply(localGoog, arguments);
        if (callSuper !== false) {
            globalGoog[methodName].apply(localGoog, arguments);
        }
    };
};

var removeNSPrefix = (symbolName) => {
    var parts = symbolName.split('\.');
    return parts[parts.length -1];
};

var nsAvailable = (nsName) => {
    var assertFields = (obj, fieldList) => {
        if (fieldList.length < 1) {
            return true;
        }
        const nextObj = obj[fieldList[0]]
        if (!nextObj) {
            return false;
        }
        return assertFields(nextObj, fieldList.splice(1));
    };
    return assertFields(globalGoog.global, nsName.split('\.'));
};

var getLocalGoog = (exports) => {
    var localGoog = Object.create(globalGoog);
    // exportSymbol doesn't do anything by itself, only when closure compiler is involved.
    overrideMethod(localGoog, "exportSymbol", function(name, value) {
        exports[removeNSPrefix(name)] = value;
    }); 
    return localGoog;
};

var eval_js = (js) => {
    var exports = {};
    var localGoog = getLocalGoog(exports);
    //console.log(name, code, js);
    sandboxedEval(js, {goog: localGoog, exports});
    return exports;
};

var DEFAULT_COMPILER_OPTIONS = {
         'logger': customLogger, // console is the object on which log() error(), etc are invoked.
         'source_loader': dummySourceLoader,
         'js_eval': eval_js
     };

var nsNameToId = (nsName) => ({name: nsName, macros: nsName.endsWith("$macros"), path: nsName.replace(/\./g, "/")});

// load cljs source, compile and evalute compiled js on demand
var loadDepNamespaces = (nsNames, compilerOptions) => {
    var nsIds = nsNames.filter(nsName => !nsAvailable(nsName) && !namespaces_under_evaluation[nsName]).map(nsNameToId);
    console.log("loadDepNamespaces loading missing namespaces", nsIds);
    return Promise.all(nsIds.map(nsId => new Promise((resolve, reject) => {
        compilerOptions.source_loader(nsId, resolve);
    }))).then(sources => {
        console.log("sources", sources);
        return sources.map(src => eval_cljs(src.filename, src.source, compilerOptions));
    });
};

var namespaces_under_evaluation = {};

var eval_cljs = (filename, cljs_source, compilerOptions) => {
    console.log("eval_cljs", filename);
     var compilerOptions = compilerOptions || DEFAULT_COMPILER_OPTIONS;
     return compile(filename, cljs_source, compilerOptions).then(
        compiler_output => {
            compiler_output.namespaces.forEach(ns => namespaces_under_evaluation[ns] = true);
            return loadDepNamespaces(compiler_output.dependencies, compilerOptions).then(
                _ => {
                    console.log("deps of ", filename, "loaded, evaluating compiled js");
                    return compilerOptions.js_eval(compiler_output.compiled_js);
                }).then(
                result => {
                    compiler_output.namespaces.forEach(ns => namespaces_under_evaluation[ns] = false);
                    return result;
                });
        },
        err => {
            console.log("got compilation error", err);
        });
};

var test = (filename, code) => {
    // TODO assertions
    return eval_cljs(filename, code);
};

var run = () => {
/*
// simple require-macro
test("test1", `
    (ns my.test1 (:require-macros my.math))
    (println (my.math/triple 5))
`);
*/

// simple require-function
test("test2", `
    (ns my.test2 (:require [my.math :as my-math-alias]))
    (println (my-math-alias/myfunc 5 6))
`);

/*
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
*/
};
