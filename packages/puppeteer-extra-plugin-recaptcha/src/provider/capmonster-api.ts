var https = require('https')
var url = require('url')

var apiKey
var apiCreateTaskUrl = 'https://api.capmonster.cloud/createTask'
var apiGetTaskResultUrl = 'https://api.capmonster.cloud/getTaskResult'
var apiReportUrl = 'https://api.capmonster.cloud/reportIncorrectTokenCaptcha'

var defaultOptions = {
  pollingInterval: 2000,
  retries: 3
}

function pollCaptcha(captchaId, options, invalid, callback) {
  invalid = invalid.bind({ options: options, captchaId: captchaId })
  var intervalId = setInterval(function () {
    var httpsRequestOptions = url.parse(apiGetTaskResultUrl)
    httpsRequestOptions.method = 'POST'

    var postData = {
      clientKey: apiKey,
      taskId: captchaId,
    }

    var serializedPostData = JSON.stringify(postData)

    var request = https.request(httpsRequestOptions, function (response) {
      var body = ''

      response.on('data', function (chunk) {
        body += chunk
      })

      response.on('end', function () {
        var result = JSON.parse(body)
        if (result.status == 'processing') {
          return
        }

        clearInterval(intervalId)

        if (result.errorId != 0) {
          callback(result.errorCode) //error
        } else {
          callback(
            null,
            {
              id: captchaId,
              text: result.solution?.gRecaptchaResponse || result.solution?.token || ''
            },
            invalid
          )
        }
        callback = function () { } // prevent the callback from being called more than once, if multiple https requests are open at the same time.
      })
    })
    request.on('error', function (e) {
      request.destroy()
      callback(e)
    })
    request.write(serializedPostData)
    request.end()
  }, options.pollingInterval || defaultOptions.pollingInterval)
}

export const setApiKey = function (key) {
  apiKey = key
}

export const decodeReCaptcha = function (
  captchaMethod,
  captcha,
  pageUrl,
  extraData,
  options,
  callback
) {
  if (!callback) {
    callback = options
    options = defaultOptions
  }
  var httpsRequestOptions = url.parse(apiCreateTaskUrl)
  httpsRequestOptions.method = 'POST'

  var postData = {
    clientKey: apiKey,
    task: {},
  }

  if (captchaMethod == 'hcaptcha') {
    postData.task = {
      type: "HCaptchaTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: captcha,
      ...extraData,
    }
  } else if (captchaMethod == 'userrecaptcha') {
    postData.task = {
      type: "NoCaptchaTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: captcha,
      ...extraData,
    }
  } else if (captchaMethod == 'turnstile') {
    postData.task = {
      type: "TurnstileTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: captcha,
      ...extraData,
    }
  }

  var serializedPostData = JSON.stringify(postData)

  var request = https.request(httpsRequestOptions, function (response) {
    var body = ''

    response.on('data', function (chunk) {
      body += chunk
    })

    response.on('end', function () {
      var result = JSON.parse(body)
      if (result.errorId != 0) {
        return callback(result.errorCode)
      }

      pollCaptcha(
        result.taskId,
        options,
        function (error) {
          var callbackToInitialCallback = callback

          report(this.captchaId)

          if (error) {
            return callbackToInitialCallback('CAPTCHA_FAILED')
          }

          if (!this.options.retries) {
            this.options.retries = defaultOptions.retries
          }
          if (this.options.retries > 1) {
            this.options.retries = this.options.retries - 1
            decodeReCaptcha(
              captchaMethod,
              captcha,
              pageUrl,
              extraData,
              this.options,
              callback
            )
          } else {
            callbackToInitialCallback('CAPTCHA_FAILED_TOO_MANY_TIMES')
          }
        },
        callback
      )
    })
  })
  request.on('error', function (e) {
    request.destroy()
    callback(e)
  })
  request.write(serializedPostData)
  request.end()
}

export const report = function (captchaId) {
  var httpsRequestOptions = url.parse(apiReportUrl)
  httpsRequestOptions.method = 'POST'

  var postData = {
    clientKey: apiKey,
    taskId: captchaId,
  }

  var serializedPostData = JSON.stringify(postData)

  var request = https.request(httpsRequestOptions, function (response) {
    //
  })
  request.write(serializedPostData)
  request.end()
}
