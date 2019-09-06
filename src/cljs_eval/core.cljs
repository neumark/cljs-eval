(ns cljs-eval.core
  (:require [cljs.js :as cjs]
            [cljs.pprint :refer [pprint]]
            [goog.array :as garray]))
; based on http://nbeloglazov.com/2016/03/11/getting-started-with-self-hosted-cljs-part-3.html
(enable-console-print!)

;; define your app data so that it doesn't get over-written on reload

(defonce compiler-state (atom {
                          :deps {:macro {
                                        "my/math" "(ns my.math) (defmacro triple [x] (* 3 x))"}
                                :normal {
                                         "my/math" "(ns my.math) (defn myfunc [x y] (+ (* x y) (* 3 x)))"}}
                          :cache {}
                          }))

(defn on-js-reload []
  ;; optionally touch your app-state to force rerendering depending on
  ;; your application
  ;; (swap! app-state update-in [:__figwheel_counter] inc)
  (println "js reloaded"))

(defn load [opts cb]
  (println "Loading dependency" opts)
  (if-let [dep-source (get-in @compiler-state [:deps (if (:macros opts) :macro :normal) (str (:path opts))])]
    (cb {:lang :clj :source dep-source})
    (throw (js/Error. (str "Unknown namespace " opts)))))

(defn print-cache [opts cb]
  (pprint opts)
  (cb {:value nil}))

(defn macro-eval  [{:keys [name source] :as compiled-ns}]
  (do
    (js/console.log (str "evaluating macro in " name))
    (pprint compiled-ns)
    (cjs/js-eval compiled-ns)))

(def compiler-opts  {:eval macro-eval
                     :verbose true
                     :load load
                     :cache-source print-cache
                     :source-map true
                     :rename-prefix "cljs_global"})

(defn noop [& _args] nil)

(defn do-compile [cljs-source {:keys [name logger source-loader on-success on-failure js-eval] :as opts}]
  (let [compiler-state (cjs/empty-state)
        cb (fn [compiled-ns] (if (:value compiled-ns)
                               (on-success (:value compilation-result))
                               (on-failure (clj->js (get-in compilation-result [:error])))))
        compiler-opts {:eval (fn [{:keys [name source] :as compiled-ns}]
                               (do
                                 (println (str "evaluating macro in " name))
                                 #_(pprint compiled-ns)
                                 (js-eval source)))
                       :verbose true
                       :load load-dep
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
                 :source-loader (or (. js-opts -source-logger) noop)
                 :js-eval (or (. js-opts -js-eval) js/eval)
                 }]
    (do-compile cljs-source options)))
