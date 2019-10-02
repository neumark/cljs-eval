(ns cljs-standalone.compiler
  (:refer-clojure :exclude [eval])
  (:require [cljs.js :as cjs]
            [cljs.pprint :refer [pprint]]
            [cljs.analyzer :as ana]
            [goog.array :as garray]
            [goog.object :as gobj]
            [clojure.string :as cljstr]
            [cognitect.transit :as transit]))

; sources:
; http://nbeloglazov.com/2016/03/11/getting-started-with-self-hosted-cljs-part-3.html
; https://github.com/swannodette/hello-cljsc/blob/master/src/hello_cljsc/core.clj
; https://github.com/arichiardi/replumb/blob/master/src/cljs/replumb/cache.cljs

;; define your app data so that it doesn't get over-written on reload
(defonce compiler-state (cjs/empty-state)) ;empty-state is an atom already
(defonce output-cache (atom {}))

(defonce _googfix (do
                    (set! js/goog.isProvided_ (fn[_] false))
                    (set! js/goog.require (fn[_] (js-obj)))))

(def DEFAULT-SOURCE-FILENAME "unknown")

(defn noop [& _args] nil)

(defn on-js-reload []
  ;; optionally touch your app-state to force rerendering depending on
  ;; your application
  ;; (swap! app-state update-in [:__figwheel_counter] inc)
  (noop "js reloaded"))

(defn ns-to-cache-key [name macros]
  (symbol (str name (if macros "$macros" ""))))

(defn get-cached-compiled-ns [cache-key]
  (get-in @output-cache [cache-key]))

(defn invoke-source-loader [source-loader ns-id cb]
  (-> (source-loader (clj->js ns-id))
      (.then #(cb (js->clj % :keywordize-keys true)))))

(defn get-loader [source-loader]
  (fn [{:keys [name macros] :as ns-id} cb]
    ;(println "Loading dependency" ns-id)
    (let [cached-compiled-ns (get-cached-compiled-ns (ns-to-cache-key name macros))]
      (if cached-compiled-ns
        (do
          ;(println "got cached compiled namespace for " ns-id cached-compiled-ns)
          (cb cached-compiled-ns))
        (do
          ;(println "no cached compiler output for " ns-id " fallback to source-loader")
          (invoke-source-loader source-loader ns-id (fn [src]
                                                      (cb {:lang :clj :source (:source src)}))))))))

(defn set-cached-compiled-ns! [cache-key compiled-ns]
  (swap! output-cache assoc cache-key compiled-ns))

(defn update-cache-handler [compiled-ns cb]
  (do
    (set-cached-compiled-ns! (get-in compiled-ns [:cache :name]) compiled-ns)
    (cb {:value nil})))


(def goog-provide-re #"^goog\.provide\(\'([^\s]+)\'\);$")

(defn remove-macros-postfix [ns]
  (subs ns 0 (- (count ns ) 7)))

(defn extract-provided-ns [compiled-js-line]
  (some-> (re-matches goog-provide-re compiled-js-line)
        second
        demunge
        ; fix improper demunging of $macros postfix
        ((fn [s] (if (cljstr/ends-with? s "/macros") (str (remove-macros-postfix s) "$macros") s)))
        symbol))

(defn get-defined-namespaces [compiled-js]
  (->> (cljstr/split-lines compiled-js)
      (map extract-provided-ns)
      (filter identity)))

(defn get-ns-cached-analysis [ns]
  (get-in @compiler-state [::ana/namespaces ns]))

(defn make-compiled-ns [ns compiled-js]
  (let [is-macros-ns (cljstr/ends-with? (str ns) "$macros")
        fixed-ns-name (if is-macros-ns (symbol (remove-macros-postfix (str ns))) ns)]
    {:lang :js
     :name fixed-ns-name
     :path (cljstr/replace (str fixed-ns-name) #"\." "/")
     :source compiled-js
                                        ; read analysis output from compiler's state
                                        ; I assume any namespace goog.provided-ed by the output JS is present in the compiler's analysis cache
     :cache (get-ns-cached-analysis ns)
     }))

(defn write-output-cache! [defined-namespaces compiled-js]
  (if (> (count defined-namespaces) 0)
    (do
      ;(println "found definitions for namespaces" defined-namespaces)
      (let [new-cache-entries (apply hash-map (mapcat (fn [ns] [ns (make-compiled-ns ns compiled-js)]) defined-namespaces))]
        ;(println "cache entry for" defined-namespaces new-cache-entries)
        (swap! output-cache merge new-cache-entries)))
    nil))

(defn get-ns-exports [ns-analysis]
  (->> (:defs ns-analysis) (vals) (filter #(= (:export %) true)) (map :name)))


(defn get-ns-dependencies [ns-analysis]
  (-> ns-analysis
      :requires
      vals
      set
      vec))

; compile-str doesn't return analysis information for the result of the compilation.
; this could be fixed by re-implementing most of what compile-str does, but a cheaper
; workaround is looking for goog.provides declarations in the output js.
; one drawback of this approach is that when there is no ns declaration (and we're working in cljs.user),
; the namespace is not detected.

(defn make-compile-cb [on-success on-failure]
  (fn [compiler-result] (if (:value compiler-result)
                          (let [compiled-js (:value compiler-result)
                                defined-namespaces (get-defined-namespaces compiled-js)
                                dependencies (mapcat #(get-ns-dependencies (get-ns-cached-analysis %)) defined-namespaces)
                                exports (mapcat #(get-ns-exports (get-ns-cached-analysis %)) defined-namespaces)]
                            (do
                              ;(println "exports" exports)
                              (write-output-cache! defined-namespaces compiled-js)
                              ; munge all symbols before passing to JS
                              (on-success {:namespaces defined-namespaces
                                           :dependencies dependencies
                                           :exports exports
                                           :compiled-js compiled-js})))
                          (on-failure (:error compiler-result)))))

(defn add-exports [context]
  (let [exports (gobj/get context "exports")]
    (do
      (gobj/set context "exports"
                (if (object? exports) exports (js-obj)))
      context)))

(defn ns-available [ns-name]
  (object? (apply gobj/getValueByKeys (cons js/goog.global (cljstr/split ns-name #"\.")))))

(defn ns-name-to-id [ns-name]
  (let [str-ns-name (str ns-name)]
    {:name str-ns-name
    :macros (cljstr/ends-with? str-ns-name "$macros")
    :path (cljstr/replace str-ns-name  #"\." "/")
    }))

(declare sandboxed-js-eval)

(defn parse-js-opts [original-js-opts]
  (let [js-opts (if (object? original-js-opts) original-js-opts (js-obj))]
      {:logger (or (gobj/get js-opts "logger") js/console)
       :source-loader (or (gobj/get js-opts "source_loader") (fn [_] (js/Promise.resolve nil)))
       :js-eval (or (gobj/get js-opts "js_eval") sandboxed-js-eval)
       :context (gobj/get js-opts "context")}))

(declare eval-internal)

(defn load-dep-namespaces [ns-names parsed-js-opts cb]
  (let [ns-ids (->> ns-names
                    (filter #(not (ns-available %)))
                    (map ns-name-to-id))
        ns-load-promises (map #(js/Promise. (fn [resolve reject] (invoke-source-loader
                                                                  (:source-loader parsed-js-opts)
                                                                  %
                                                                  (fn [src]
                                                                    (resolve src))))) ns-ids)
        invoke-eval (fn [source]
                      (eval-internal
                       (:filename source)
                       (:source source)
                       parsed-js-opts))]
    (-> (js/Promise.all (apply array ns-load-promises))
        (.then (fn [sources] (js/Promise.all (apply array (map invoke-eval (array-seq sources))))))
        (.then cb))))

; copied from replumb source
(defn transit-json->edn
  [json]
  (->> json (transit/read (transit/reader :json))))

(defn edn->transit-json
  [edn]
  (->> edn (transit/write (transit/writer :json))))

(defn save-exports! [declared-exports exports-obj]
  (let [fix-name (fn [n] (-> n
                                        ;(#(do (pprint %) %))
                             str
                             (cljstr/replace "-" "_")
                             (cljstr/split "/")))
        fixed-names (map fix-name declared-exports)]
    (reduce (fn [acc name]
              (do
                (gobj/set acc (second name)
                          (js/goog.getObjectByName (cljstr/join "." name)))
                acc))
            exports-obj
            fixed-names)))

(defn compile-internal [filename cljs-source parsed-js-opts]
   (let [on-success (atom nil)
         on-failure (atom nil)
         promise (js/Promise. (fn [resolve reject] (do
                                                     (swap! on-success (fn [_] resolve))
                                                     (swap! on-failure (fn [_] reject)))))
         {:keys [logger source-loader js-eval]} parsed-js-opts
         cb (make-compile-cb @on-success @on-failure)
         compiler-opts {; eval is necessary because the compiler needs to evaluate macros to compile source
                        :eval (fn [{:keys [name source] :as compiled-ns}]
                                ((:js-eval parsed-js-opts) source))
                        :verbose false
                        :load (get-loader source-loader)
                        ; note: cache-source fn is only called by the compiler when macros are
                        ; compiled and evaluted in order to compile code which refer-macros them.
                        ; normally, the compiler will not call this method when code is compiled, this
                        ; must be done manually in the callback fn passed to compile-str
                        :cache-source update-cache-handler
                        :source-map true}]
    (binding [cljs.core/*print-newline* false
              cljs.core/*print-fn* (fn []
                                     (let [xs (js-arguments)]
                                       (.apply (.-log logger) logger (garray/clone xs))))
              cljs.core/*print-err-fn* (fn []
                                         (let [xs (js-arguments)]
                                           (.apply (.-error logger) logger (garray/clone xs))))]
      (do
        (cjs/compile-str compiler-state cljs-source (or filename DEFAULT-SOURCE-FILENAME) compiler-opts cb)
        promise))))

(defn eval-internal
  [filename source parsed-js-opts]
  (let [run (fn [compiler-output]
              (let [js-eval-fn (:js-eval parsed-js-opts)
                    compiled-js (:compiled-js compiler-output)
                    declared-exports (:exports compiler-output)
                    context (:context parsed-js-opts)
                    exports-obj (js-eval-fn compiled-js context)]
                (do
                  (save-exports! declared-exports exports-obj)
                  exports-obj)))
        compile-deps (fn [compiler-output]
                       (load-dep-namespaces
                        (:dependencies compiler-output)
                        parsed-js-opts
                        (fn [_] (run compiler-output))))]
    (-> (compile-internal filename source parsed-js-opts)
        (.then compile-deps))))


; --- PUBLIC API ---
(defn ^:export sandboxed-js-eval [code base-context]
  (let [context (add-exports (if (object? base-context) base-context (js-obj)))
        context-keys (js/Object.keys context)
        sandboxed-code (str "(function(" (cljstr/join "," context-keys) ") {return (function(){\n" code "\n;})();})\n")
        func (js/goog.global.eval sandboxed-code)
        exports (js-obj)
        args (apply array (map #(gobj/get context %) (array-seq context-keys)))]
    (do
      (.apply func nil args)
      exports)))

(defn ^:export clear-cache []
  (do
    (set! compiler-state (cjs/empty-state))
    (reset! output-cache {})))

(defn ^:export compile
  ([cljs-source]
   (compile nil cljs-source nil))
  ([filename cljs-source]
   (compile filename cljs-source nil))
  ([filename cljs-source js-opts]
   (-> (compile-internal filename cljs-source (parse-js-opts js-opts))
       (.then clj->js))))

(defn ^:export dump-cache []
  (edn->transit-json @output-cache))

(defn ^:export load-cache [serialized-cache]
  (let [cache-data (transit-json->edn serialized-cache)]
    (do
      ; update analysis cache
      (->> cache-data
          vals
          (map :cache)
          (map #(swap!
                 ; based on cljsjs.empty-state
                 compiler-state
                 (fn [state]
                   (-> state
                       (assoc-in [::ana/namespaces (:name %)] %))))))
      ; update compiled output cache
      (swap! output-cache merge cache-data))))

(defn ^:export eval
  ([source]
   (eval nil source nil))
  ([filename source]
   (eval filename source nil))
  ([filename source js-opts]
   (eval-internal filename source (parse-js-opts js-opts))))
