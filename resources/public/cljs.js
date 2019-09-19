var globalGoog = window.goog;
// allow redefinition of namespaces
goog.isProvided_ = (_) => false;
// because of the change above, goog.require
// now throws errors in dev mode. Since it doesn't actually do
// anything we can just get rid of it.
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
	code = "(function(" + contextNames.join(",") + ") {return (function(){\n" + code + "\n;})();})\n";
	// Compile the code into a function
	var fn;
        // NOTE: cljs compiler also specifies sourceURL,  need to give this twice (with different values)? harmless if redundant.
		fn = window["eval"](code);
	// Call the function and return the exports
	return fn.apply(null,contextValues);
};

var compile = (filename, source, options) => {
     return new Promise((resolve, reject) => {
         var extendedOpts = Object.assign({}, options, {
             on_success: resolve,
             on_failure: reject,
             name: filename});
         globalGoog.global.cljs_standalone.compiler.compile(source, extendedOpts);
     });
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

var eval_js = (js, baseContext) => {
    console.log("EVAL JS START",js, "EVAL JS END");
    var exports = {};
    var context = Object.assign({}, {exports}, baseContext || {});
    sandboxedEval(js, context);
    return exports;
};

var nsNameToId = (nsName) => ({name: nsName, macros: nsName.endsWith("$macros"), path: nsName.replace(/\./g, "/")});

// load cljs source, compile and evalute compiled js on demand
var loadDepNamespaces = (nsNames, compilerOptions) => {
    var nsIds = nsNames.filter(nsName => !nsAvailable(nsName) && !namespaces_under_evaluation[nsName]).map(nsNameToId);
    // console.log("loadDepNamespaces loading missing namespaces", nsIds);
    return Promise.all(nsIds.map(nsId => new Promise((resolve, reject) => {
        compilerOptions.source_loader(nsId, resolve);
    }))).then(sources => {
        // console.log("sources", sources);
        return Promise.all(sources.map(src => eval_cljs(src.filename, src.source, compilerOptions)));
    });
};

// serves to short-circuit cyclic dependency loading loops; may prove to be unnecessary
var namespaces_under_evaluation = {};

var eval_cljs = (filename, cljs_source, compilerOptions) => {
    // console.log("eval_cljs", filename);
    return compile(filename, cljs_source, compilerOptions).then(
        compiler_output => {
            console.log(compiler_output);
            compiler_output.namespaces.forEach(ns => namespaces_under_evaluation[ns] = true);
            return loadDepNamespaces(compiler_output.dependencies, compilerOptions).then(
                    _ => {
                        var exports = compilerOptions.js_eval(compiler_output.compiled_js, compilerOptions.context);
                        // save exports
                        // console.log("exports", compiler_output.exports);
                        // this actually becomes a lot simpler when there is no js / cljs duality because
                        // no munging / demunging is necessary.
                        compiler_output.exports.forEach(symbol => {
                            var dummyMunge = (s) => s.replace(/-/g, "_");
                            var symbolParts = symbol.split("/");
                            exports[dummyMunge(symbolParts[1])] = goog.getObjectByName(dummyMunge(symbolParts[0]) + "." + dummyMunge(symbolParts[1]));
                        });
                        return exports;
                }).then(
                    result => {
                        compiler_output.namespaces.forEach(ns => namespaces_under_evaluation[ns] = false);
                        return result;
                });
        });
};
