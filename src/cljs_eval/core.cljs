(ns cljs-eval.core
  (:require [cljs.js :as cjs]
            [cljs.pprint :refer [pprint]]
            [goog.array :as garray]))
; based on http://nbeloglazov.com/2016/03/11/getting-started-with-self-hosted-cljs-part-3.html

;; define your app data so that it doesn't get over-written on reload
(defonce compiler-cache (atom {}))

(defn on-js-reload []
  ;; optionally touch your app-state to force rerendering depending on
  ;; your application
  ;; (swap! app-state update-in [:__figwheel_counter] inc)
  (println "js reloaded"))

(defn get-cached-compiled-ns [name macros]
  (let [cache-key (str name (if macros "$macros" ""))]
    (get @compiler-cache cache-key)))

(defn invoke-source-loader [source-loader {:keys [name macros path] :as ns-id} cb]
  (if-let [dep-source (source-loader (clj->js ns-id))]
    (cb {:lang :clj :source dep-source})
                                        ; another option is to throw exception
                                        ;(throw (js/Error. (str "Unknown namespace " ns-id)))
    (cb nil)))

(defn get-loader [source-loader]
  (fn [{:keys [name macros] :as ns-id} cb]
    (println "Loading dependency" ns-id)
    (let [cached-compiled-ns (get-cached-compiled-ns name macros)]
      (if cached-compiled-ns
        (do
          (println "got cached compiled namespace for " ns-id)
          (cb {:lang :js :source (:source cached-compiled-ns) :cache (:cache cached-compiled-ns)}))
        (do
          (println "no cached compiler output for " ns-id " fallback to source-loader")
          (invoke-source-loader source-loader ns-id cb))))))

(defn print-cache [opts cb]
  (pprint opts)
  (cb {:value nil}))

(defn noop [& _args] nil)

(defn do-compile [cljs-source {:keys [name logger source-loader on-success on-failure js-eval] :as opts}]
  (let [compiler-state (cjs/empty-state)
        cb (fn [compiled-ns] (if (:value compiled-ns)
                               (on-success (:value compiled-ns))
                               (let [error (:error compiled-ns)]
                                 (on-failure (js-obj
                                              "message" (.-message error)
                                              "data" (clj->js (.-data error))
                                              "cause" (.-cause error))))))
        compiler-opts {:eval (fn [{:keys [name source] :as compiled-ns}]
                               (do
                                 (println (str "evaluating macro in " name))
                                 #_(pprint compiled-ns)
                                 (js-eval source)))
                       :verbose true
                       :load (get-loader source-loader)
                       :cache-source print-cache
                       :source-map true}]
    (binding [cljs.core/*print-newline* false
              cljs.core/*print-fn* (fn []
                                     (let [xs (js-arguments)]
                                       (.apply (.-log logger) logger (garray/clone xs))))
              cljs.core/*print-err-fn* (fn []
                                         (let [xs (js-arguments)]
                                           (.apply (.-error logger) logger (garray/clone xs))))]
      (cjs/compile-str compiler-state cljs-source name compiler-opts cb))))


(defn ^:export compile [cljs-source js-opts]
  (let [options {:on-success (or (. js-opts -on-success) noop)
                 :on-failure (or (. js-opts -on-failure) noop)
                 :name (or (. js-opts -name) "unknown")
                 :logger (or (. js-opts -logger) js/console)
                 :source-loader (or (. js-opts -source-loader) noop)
                 :js-eval (or (. js-opts -js-eval) js/eval)
                 }]
    (do-compile cljs-source options)))
