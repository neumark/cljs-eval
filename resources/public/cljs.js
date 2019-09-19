// serves to short-circuit cyclic dependency loading loops; may prove to be unnecessary
var eval_cljs = (filename, cljs_source, compilerOptions) => {
    // console.log("eval_cljs", filename);
    return goog.global.cljs_standalone.compiler.compile(filename, cljs_source, compilerOptions).then(
        compiler_output => {
            return cljs_standalone.compiler.load_dep_namespaces(compiler_output.dependencies, compilerOptions).then(
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
                });
        });
};
