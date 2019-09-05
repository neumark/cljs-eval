(ns cljs-eval.core
  (:require [cljs.js :as cjs]
            [cljs.pprint :refer [pprint]]))

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
  (println "js reloaded")
  (println @compiler-state))

(defn load [opts cb]
  (println "Loading dependency" opts)
  (if-let [dep-source (get-in @compiler-state [:deps (if (:macros opts) :macro :normal) (str (:path opts))])]
    (cb {:lang :clj :source dep-source})
    (throw (js/Error. (str "Unknown namespace " opts)))))

(defn print-cache [opts cb]
  (pprint opts)
  (cb {:value nil}))

(defn macro-eval [src]
  (do
    (js/console.log "evaluating macro")
    (pprint src)
    (cjs/js-eval src)))

(def compiler-opts  {:eval macro-eval
                     :verbose true
                     :load load
                     :cache-source print-cache
                     :source-map true
                     :rename-prefix "cljs_global"})

(defn compile [name source opts cb]
  (cjs/compile-str
   (cjs/empty-state)
   source
   name
   compiler-opts cb))


(defn ^:export compile-public [name source on-success on-failure]
  (compile
   name
   source
   (or name "compilation-unit")
   (fn [compilation-result] (if (:value compilation-result)
                              (on-success (clj->js (:value compilation-result)))
                              (on-failure (clj->js (get-in compilation-result [:error])))))))
