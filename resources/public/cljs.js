var nsNameToId = (nsName) => ({name: nsName, macros: nsName.endsWith("$macros"), path: nsName.replace(/\./g, "/")});

// load cljs source, compile and evalute compiled js on demand
var loadDepNamespaces = (nsNames, compilerOptions) => {
    var nsIds = nsNames.filter(nsName => !cljs_standalone.compiler.ns_available(nsName) && !namespaces_under_evaluation[nsName]).map(nsNameToId);
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
    return goog.global.cljs_standalone.compiler.compile(filename, cljs_source, compilerOptions).then(
        compiler_output => {
            //console.log(compiler_output);
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
