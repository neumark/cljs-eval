var globalGoog = window.goog;
// allow redefinition of namespaces
goog.isProvided_ = (_) => false;

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
    }
    cb(null);
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

// load cljs source, compile and evalute compiled js on demand
var loadNamespaceJIT = (nsName, compilerOptions) => {
    var namespaceId = {name: nsName, macros: nsName.endsWith("$macros"), path: nsName.replace(/\./g, "/")};
    return new Promise((resolve, reject) => {
        compilerOptions.source_loader(namespaceId, resolve);
    }).then(src => {
        return compile(src.filename, src.source, compilerOptions);
    }).then(js => {
        return evaljs(js, compilerOptions);
    });
};

var patchedGoogRequire = async (nsName, compilerOptions) => {
    if (!nsAvailable(nsName)) {
        console.log("detected unavailable namespace", nsName);
        // goog.require is sync, but sourceLoader and compiler have sync interfaces.
        // to do just in time code loading, we need to await.
        if (compilerOptions) {
            return await loadNamespaceJIT(nsName, compilerOptions);
        }
    }
    return null;
};

var getLocalGoog = (exports, compilerOptions) => {
    var localGoog = Object.create(globalGoog);
    // exportSymbol doesn't do anything by itself, only when closure compiler is involved.
    overrideMethod(localGoog, "exportSymbol", function(name, value) {
        exports[removeNSPrefix(name)] = value;
    }); 
    // require doesn't do anything by default, but it needs to execute compiled namespaces on demand
    // if they are not available.
    overrideMethod(localGoog, "require", async (nsName) => patchedGoogRequire(nsName, compilerOptions), false);
    // provide ensures ns object, eg: window.name.namespace is defined.
    overrideMethod(localGoog, "provide", function() { console.log("provide", arguments); });
    return localGoog;
};

var evaljs = (js, compilerOptions) => {
   var exports = {};
   var localGoog = getLocalGoog(exports, compilerOptions);
   //console.log(name, code, js);
   sandboxedEval(js, {goog: localGoog, exports}); 
};

 var test = (filename, code) => {
     var compilerOptions = {
         'logger': customLogger, // console is the object on which log() error(), etc are invoked.
         'source_loader': dummySourceLoader,
         'js_eval': evaljs
     };
     return compile(filename, code, compilerOptions).then(
        js => evaljs(js, compilerOptions),
        err => {
            console.log("got compilation error", err);
        });
 };

var run = () => {
// simple require-macro
test("test1", `
    (ns my.test1 (:require-macros my.math))
    (println (my.math/triple 5))
`);

// simple require-function
test("test2", `
    (ns my.test2 (:require my.math))
    (println (my.math/myfunc 5 6))
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

};
