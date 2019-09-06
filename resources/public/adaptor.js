console.log("straight ol' js");

var globalGoog = window.goog;

// based on TW5/boot/boot.js
var sandboxedEval = function(code,context,filename) {
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
        // TODO: cljs compiler also specifies sourceURL, no need to give this twice (with different values)
		fn = window["eval"](code + "\n\n//# sourceURL=" + filename);
	// Call the function and return the exports
	return fn.apply(null,contextValues);
};


 var compile = (filename, source) => {
     return new Promise((resolve, reject) => {
         window.cljs_eval.core.compile(source, {
             'name': filename,
             'logger': console, // console is the object on which log() error(), etc are invoked.
             'on_success': resolve,
             'on_failure': reject
             // source-loader
             // js-eval
         });
     });
 };

var PatchedGoogCls = function(){};
PatchedGoogCls.prototype = globalGoog;
// allow redefinition of namespaces
goog.isProvided_ = (_) => false;

var overrideMethod = function (localGoog, methodName, methodFn, callSuper) {
    localGoog[methodName] = function() {
        methodFn.apply(localGoog, arguments);
        if (callSuper) {
            globalGoog[methodName].apply(localGoog, arguments);
        }
    };
};

var removeNSPrefix = (symbolName) => {
    var parts = symbolName.split('\.');
    return parts[parts.length -1];
};

var getLocalGoog = (exports) => {
    var localGoog = new PatchedGoogCls();
    // exportSymbol doesn't do anything by itself, only when closure compiler is involved.
    overrideMethod(localGoog, "exportSymbol", function(name, value) {
        exports[removeNSPrefix(name)] = value;
    }, false); // do not export globally, only to the exports dictionary
    // require doesn't do anything by default, but it needs to compile referenced namespaces on demand in the future.
    overrideMethod(localGoog, "require", function() { console.log("require", arguments); }, false);
    // provide ensures window.name.codes.namespace is defined.
    overrideMethod(localGoog, "provide", function() { console.log("provide", arguments); }, true);
    return localGoog;
};

 var test = (name, code) => {
     compile(name, code).then(js => {
        var exports = {};
        var goog = getLocalGoog(exports);
        console.log(name, code, js);
        sandboxedEval(js, {goog, exports}, name); 
     });
 };

var run = () => {
// simple require-macro
test("test1", `
    (ns my.test1 (:require-macros my.math))
    (println (my.math/triple 5))
`);

// simple require-function
/* this compiles but does not yet run because my.math is not known to goog.
test("test2", `
    (ns my.test2 (:require my.math))
    (println (my.math/myfunc 5 6))
`);
*/

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


};
