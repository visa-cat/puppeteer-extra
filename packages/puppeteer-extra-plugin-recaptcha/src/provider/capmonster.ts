export const PROVIDER_ID = 'capmonster'
import * as types from '../types'

import Debug from 'debug'
const debug = Debug(`puppeteer-extra-plugin:recaptcha:${PROVIDER_ID}`)

import * as solver from './capmonster-api'

const secondsBetweenDates = (before: Date, after: Date) =>
  (after.getTime() - before.getTime()) / 1000

export interface DecodeRecaptchaAsyncResult {
  err?: any
  result?: any
  invalid?: any
}

export interface TwoCaptchaProviderOpts {
  useEnterpriseFlag?: boolean
  useActionValue?: boolean
}

const providerOptsDefaults: TwoCaptchaProviderOpts = {
  useEnterpriseFlag: false, // Seems to make solving chance worse?
  useActionValue: true
}

async function decodeRecaptchaAsync(
  token: string,
  vendor: types.CaptchaVendor,
  sitekey: string,
  url: string,
  extraData: any,
  opts = { pollingInterval: 2000 }
): Promise<DecodeRecaptchaAsyncResult> {
  return new Promise(resolve => {
    const cb = (err: any, result: any, invalid: any) =>
      resolve({ err, result, invalid })
    try {
      solver.setApiKey(token)

      let method = 'userrecaptcha'
      if (vendor === 'hcaptcha') {
        method = 'hcaptcha'
      }
      solver.decodeReCaptcha(method, sitekey, url, extraData, opts, cb)
    } catch (error) {
      return resolve({ err: error })
    }
  })
}

export async function getSolutions(
  captchas: types.CaptchaInfo[] = [],
  token: string = '',
  opts: TwoCaptchaProviderOpts = {}
): Promise<types.GetSolutionsResult> {
  opts = { ...providerOptsDefaults, ...opts }
  const solutions = await Promise.all(
    captchas.map(c => getSolution(c, token, opts))
  )
  return { solutions, error: solutions.find(s => !!s.error) }
}

async function getSolution(
  captcha: types.CaptchaInfo,
  token: string,
  opts: TwoCaptchaProviderOpts
): Promise<types.CaptchaSolution> {
  const solution: types.CaptchaSolution = {
    _vendor: captcha._vendor,
    provider: PROVIDER_ID
  }
  try {
    if (!captcha || !captcha.sitekey || !captcha.url || !captcha.id) {
      throw new Error('Missing data in captcha')
    }
    solution.id = captcha.id
    solution.requestAt = new Date()
    debug('Requesting solution..', solution)
    const extraData = {}
    if (captcha.s) {
      extraData['recaptchaDataSValue'] = captcha.s // google site specific property
    }
    if (captcha.isInvisible) {
      extraData['isInvisible'] = true
    }

    if (process.env['CAPMONSTER_PROXY_TYPE'] &&
      process.env['CAPMONSTER_PROXY_ADDRESS'] &&
      process.env['CAPMONSTER_PROXY_PORT']) {
      extraData['proxyType'] = process.env['CAPMONSTER_PROXY_TYPE'].toUpperCase()
      extraData['proxyAddress'] = process.env['CAPMONSTER_PROXY_ADDRESS']
      extraData['proxyPort'] = process.env['CAPMONSTER_PROXY_PORT']
      extraData['proxyLogin'] = process.env['CAPMONSTER_PROXY_LOGIN']
      extraData['proxyPassword'] = process.env['CAPMONSTER_PROXY_PASSWORD']
    }

    const { err, result, invalid } = await decodeRecaptchaAsync(
      token,
      captcha._vendor,
      captcha.sitekey,
      captcha.url,
      extraData
    )
    debug('Got response', { err, result, invalid })
    if (err) throw new Error(`${PROVIDER_ID} error: ${err}`)
    if (!result || !result.text || !result.id) {
      throw new Error(`${PROVIDER_ID} error: Missing response data: ${result}`)
    }
    solution.providerCaptchaId = result.id
    solution.text = result.text
    solution.responseAt = new Date()
    solution.hasSolution = !!solution.text
    solution.duration = secondsBetweenDates(
      solution.requestAt,
      solution.responseAt
    )
  } catch (error) {
    debug('Error', error)
    solution.error = error.toString()
  }
  return solution
}
