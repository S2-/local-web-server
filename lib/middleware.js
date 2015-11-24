'use strict'
const path = require('path')
const http = require('http')
const url = require('url')
const arrayify = require('array-back')
const t = require('typical')
const pathToRegexp = require('path-to-regexp')
const debug = require('debug')('local-web-server')

/**
 * @module middleware
 */
exports.proxyRequest = proxyRequest
exports.blacklist = blacklist
exports.mockResponses = mockResponses
exports.mime = mime

function proxyRequest (route, app) {
  const httpProxy = require('http-proxy')
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true
  })

  return function proxyMiddleware () {
    const next = arguments[arguments.length - 1]
    const keys = []
    route.re = pathToRegexp(route.from, keys)
    route.new = this.url.replace(route.re, route.to)

    keys.forEach((key, index) => {
      const re = RegExp(`:${key.name}`, 'g')
      route.new = route.new
        .replace(re, arguments[index + 1] || '')
    })

    /* test no keys remain in the new path */
    keys.length = 0
    pathToRegexp(url.parse(route.new).path, keys)
    if (keys.length) {
      this.throw(500, `[PROXY] Invalid target URL: ${route.new}`)
      return next()
    }

    this.response = false
    debug('proxy request', `from: ${this.path}, to: ${url.parse(route.new).href}`)

    proxy.once('error', err => {
      this.throw(500, `[PROXY] ${err.message}: ${route.new}`)
    })
    proxy.once('proxyReq', function (proxyReq) {
      proxyReq.path = url.parse(route.new).path
    })
    proxy.web(this.req, this.res, { target: route.new })
  }
}

function blacklist (forbid) {
  return function blacklist (ctx, next) {
    if (forbid.some(expression => pathToRegexp(expression).test(ctx.path))) {
      ctx.throw(403, http.STATUS_CODES[403])
    } else {
      return next()
    }
  }
}

function mime (mimeTypes) {
  return function mime (ctx, next) {
    return next().then(() => {
      const reqPathExtension = path.extname(ctx.path).slice(1)
      Object.keys(mimeTypes).forEach(mimeType => {
        const extsToOverride = mimeTypes[mimeType]
        if (extsToOverride.indexOf(reqPathExtension) > -1) ctx.type = mimeType
      })
    })
  }
}

function mockResponses (route, targets) {
  targets = arrayify(targets)
  debug('mock route: %s, targets: %j', route, targets);
  const pathRe = pathToRegexp(route)

  return function mockResponse (ctx, next) {
    if (pathRe.test(ctx.url)) {
      const testValue = require('test-value')

      /* find a mock with compatible method and accepts */
      let target = targets.find(target => {
        return testValue(target, {
          request: {
            method: [ ctx.method, undefined ],
            accepts: type => ctx.accepts(type)
          }
        })
      })

      /* else take the first target without a request (no request means 'all requests') */
      if (!target) {
        target = targets.find(target => !target.request)
      }

      if (target) {
        debug('target response: %j', target.response)
        if (t.isFunction(target.response)) {
          const pathMatches = ctx.url.match(pathRe).slice(1)
          target.response.apply(null, [ctx].concat(pathMatches))
        } else {
          Object.assign(ctx.response, target.response)
        }

      }
    } else {
      return next()
    }
  }
}