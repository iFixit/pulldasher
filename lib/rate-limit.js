var Promise = require('promise'),
    debug = require('./debug')('pulldasher:rate-limit');

// Number of remaining requests that will activate the rate-limiter.
// 5000 == always rate limit
// 1000 == let 4000 requests go as fast as they can, then limit to one per 3s
// Effectively, higher = more steady, but slow, lower = fast bursts, but much
// slower as we get closer to the limit
var chokePoint = 2000;

// Wraps a promise returing function in a function that checks responses for
// github's rate-limit headers and delays firing of requests to attempt to
// stay under the rate limit.
module.exports = function rateLimit(promiseFunc) {
   return function () {
      var args = arguments;
      return throttleRequest().then(function() {
         return promiseFunc.apply(null, args);
      }).then(captureRateLimitInfo);
   };
};

// FIFO queue of request callbacks to github
var requestQueue = [];
// number of requests remaining before we hit the rate limit
var remaining = null;
// timestamp of the next time rate limit will be reset
var resetAt;

/**
 * Return a promise that resolves immediately (if we don't need to slow down)
 * or resolves later with a delay if we need to stay under the rate limit.
 */
function throttleRequest() {
   if (remaining !== null && remaining < chokePoint) {
      return new Promise(function (resolve, reject) {
         queue(resolve);
      });
   }
   return Promise.resolve();
}

/**
 * Records the rate limit headers from a response and returns the response
 *
 * Can be injected in a .then() chain and won't change the resolved value
 */
function captureRateLimitInfo(response) {
   if (response && response.meta) {
      remaining = Number(response.meta['x-ratelimit-remaining']);
      if (response.meta['x-ratelimit-reset']) {
         resetAt = Number(response.meta['x-ratelimit-reset']);
      }
      debug("Response received, requests remaining: %s reset at: %s", remaining, resetAt);
   }
   return response;
}

var drainer;
function drainOne() {
   if (requestQueue.length) {
      var resolve = requestQueue.shift();
      resolve();
      var delay = interval();
      debug("Delayed request: %s (ms)", delay);
      drainer = setTimeout(drainOne, delay);
   } else {
      drainer = null;
   }
}

function queue(resolve) {
   requestQueue.push(resolve);
   startDrainer();
}

function startDrainer() {
   if (!drainer) {
      drainOne();
   }
}

function interval() {
   var requestsRemaining = Math.max(1, remaining);
   // Always underconsume, and leave a minute's worth of requests remaining
   // just in case our clock drifts from githubs
   var timeTillReset = Math.max(1, (60 + resetAt) * 1000 - Date.now());
   return timeTillReset / requestsRemaining;
}
