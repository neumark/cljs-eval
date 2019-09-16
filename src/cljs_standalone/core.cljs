(ns cljs-standalone.core
  (:require [cljs.js :as cjs]
            [cljs.pprint :refer [pprint]]
            [cljs.analyzer :as ana]
            [goog.array :as garray]
            [goog.object :as gobj :refer [get]]
            [clojure.string :as cljstr :refer [split-lines, replace]]
            [cognitect.transit :as transit]
            [js.test :as test]))

; based on http://nbeloglazov.com/2016/03/11/getting-started-with-self-hosted-cljs-part-3.html

;; define your app data so that it doesn't get over-written on reload
(defonce compiler-state (cjs/empty-state)) ;empty-state is an atom already
(defonce output-cache (atom {}))

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

(defn invoke-source-loader [source-loader {:keys [name macros path] :as ns-id} cb]
  (source-loader (clj->js ns-id) #(cb {:lang :clj :source (gobj/get % "source")})))

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
          (invoke-source-loader source-loader ns-id cb))))))

(defn set-cached-compiled-ns! [cache-key compiled-ns]
  (swap! output-cache assoc cache-key compiled-ns))

(defn update-cache-handler [compiled-ns cb]
  (do
    (set-cached-compiled-ns! (str (get-in compiled-ns [:cache :name])) compiled-ns)
    (cb {:value nil})))


(def goog-provide-re #"^goog\.provide\(\'([^\s]+)\'\);$")

(defn extract-provided-ns [compiled-js-line]
  (if-let [match (re-matches goog-provide-re compiled-js-line)]
    (symbol (second match))
    nil))

(defn get-defined-namespaces [compiled-js]
  (->> (cljstr/split-lines compiled-js)
      (map extract-provided-ns)
      (filter identity)))

(defn get-ns-cached-analysis [ns]
  (get-in @compiler-state [::ana/namespaces ns]))

(defn make-compiled-ns [ns compiled-js]
  {:lang :js
   :name ns
   :path (cljstr/replace (str ns) #"\." "/")
   :source compiled-js
   ; read analysis output from compiler's state
   ; I assume any namespace goog.provided-ed by the output JS is present in the compiler's analysis cache
   :cache (get-ns-cached-analysis ns)
  })

(defn write-output-cache! [defined-namespaces compiled-js]
  (if (> (count defined-namespaces) 0)
    (do
      ;(println "found definitions for namespaces" defined-namespaces)
      (let [new-cache-entries (apply hash-map (mapcat (fn [ns] [ns (make-compiled-ns ns compiled-js)]) defined-namespaces))]
        ;(println "cache entry for" defined-namespaces new-cache-entries)
        (swap! output-cache merge new-cache-entries)))
    nil))

(defn get-ns-exports [ns-analysis]
  (->> ns-analysis (vals) (filter #(= (:export %) true)) (map :name)))


(defn get-ns-dependencies [ns-analysis]
  ; TODO: no need to return req-macros because those are not really dependencies: they've
  ; already been evaluated by the time compilation is complete, therefore they are no longer needed.
  (let [reqs (vals (:requires ns-analysis))
        req-macros (vals (:require-macros ns-analysis))]
    (-> (concat
         reqs
         (map #(symbol (str % "$macros")) req-macros))
        set
        vec)))

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
                              (on-success (clj->js {:namespaces defined-namespaces
                                                    :dependencies dependencies
                                                    :exports exports
                                                    :compiled_js compiled-js}))))
                          (let [error (:error compiler-result)]
                            (on-failure (js-obj
                                         "message" (.-message error)
                                         "data" (clj->js (.-data error))
                                         "cause" (.-cause error)))))))

(defn get-js-evaluator [js-eval]
  (fn [{:keys [name source] :as compiled-ns}]
    (do
      ;(println (str "evaluating macro in " name))
      (js-eval source))))

(defn do-compile [cljs-source {:keys [name logger source-loader on-success on-failure js-eval] :as opts}]
  (let [cb (make-compile-cb on-success on-failure)
        compiler-opts {; eval is necessary because the compiler needs to evaluate macros to compile source
                       :eval (get-js-evaluator js-eval)
                       :verbose false
                       :load (get-loader source-loader)
                       ; note: cache-source fn is only called by the compiler when macros are
                       ; compiled and evaluted in order to compile code which refer-macros them.
                       ; normally, the compiler will not call this method when code is compiled, this
                       ; must be done manually in the callback fn passed to compile-str
                       :cache-source update-cache-handler
                       ;:context :expr
                       :source-map true}]
    (binding [cljs.core/*print-newline* true
              cljs.core/*print-fn* (fn []
                                     (let [xs (js-arguments)]
                                       (.apply (.-log logger) logger (garray/clone xs))))
              cljs.core/*print-err-fn* (fn []
                                         (let [xs (js-arguments)]
                                           (.apply (.-error logger) logger (garray/clone xs))))]
      (cjs/compile-str compiler-state cljs-source name compiler-opts cb))))

(defn parse-js-opts [js-opts]
  {:on-success (or (. js-opts -on-success) noop)
   :on-failure (or (. js-opts -on-failure) noop)
   :name (or (. js-opts -name) "unknown")
   :logger (or (. js-opts -logger) js/console)
   :source-loader (or (. js-opts -source-loader) (fn [_ cb] (cb nil)))
   :js-eval (or (. js-opts -js-eval) js/eval)})


(defn ^:export clear-cache []
  (do
    (reset! compiler-state (cjs/empty-state))
    (reset! output-cache {})))

(defn ^:export compile [cljs-source js-opts]
  (let [options (parse-js-opts js-opts)]
    (do-compile cljs-source options)))

(defn ^:export call-test []
  (test/sayHello))

;; copied from replumb source

(defn transit-json->edn
  [json]
  (->> json (transit/read (transit/reader :json))))

(defn edn->transit-json
  [edn]
  (->> edn (transit/write (transit/writer :json))))

(defn ^:export dump-cache []
  (edn->transit-json @output-cache))

