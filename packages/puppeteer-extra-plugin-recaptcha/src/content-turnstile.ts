import * as types from './types'

export const ContentScriptDefaultOpts: types.ContentScriptOpts = {
  visualFeedback: true
}

export const ContentScriptDefaultData: types.ContentScriptData = {
  solutions: []
}

/**
 * Content script for Turnstile handling (runs in browser context)
 * @note External modules are not supported here (due to content script isolation)
 */
export class TurnstileContentScript {
  private opts: types.ContentScriptOpts
  private data: types.ContentScriptData

  private baseUrls = [
    'challenges.cloudflare.com/cdn-cgi/challenge-platform',
  ]

  constructor(
    opts = ContentScriptDefaultOpts,
    data = ContentScriptDefaultData
  ) {
    // Workaround for https://github.com/esbuild-kit/tsx/issues/113
    if (typeof globalThis.__name === 'undefined') {
      globalThis.__defProp = Object.defineProperty
      globalThis.__name = (target, value) =>
        globalThis.__defProp(target, 'name', { value, configurable: true })
    }

    this.opts = opts
    this.data = data
  }

  private async _waitUntilDocumentReady() {
    return new Promise(function (resolve) {
      if (!document || !window) return resolve(null)
      const loadedAlready = /^loaded|^i|^c/.test(document.readyState)
      if (loadedAlready) return resolve(null)

      function onReady() {
        resolve(null)
        document.removeEventListener('DOMContentLoaded', onReady)
        window.removeEventListener('load', onReady)
      }

      document.addEventListener('DOMContentLoaded', onReady)
      window.addEventListener('load', onReady)
    })
  }

  private _paintCaptchaBusy($iframe: HTMLIFrameElement) {
    try {
      if (this.opts.visualFeedback) {
        $iframe.style.filter = `opacity(60%) hue-rotate(270deg)` // violet
      }
    } catch (error) {
      // noop
    }
    return $iframe
  }

  // private _paintCaptchaSolved($iframe: HTMLIFrameElement) {
  //   try {
  //     if (this.opts.visualFeedback) {
  //       $iframe.style.filter = `opacity(60%) hue-rotate(90deg)` // green
  //     }
  //   } catch (error) {
  //     // noop
  //   }
  //   return $iframe
  // }

  /** Regular checkboxes */
  private _findRegularCheckboxes() {
    const nodeList = document.querySelectorAll<HTMLIFrameElement>(
      this.baseUrls.map(url => `iframe[src*='${url}']`).join(',')
    )
    return Array.from(nodeList)
  }

  private getResponseInputById(id?: string): HTMLInputElement {
    if (!id) return

    // const $iframe = this._findVisibleIframeNodeById(id)
    // if (!$iframe) return
    // const $parentForm = $iframe.closest(`form`)
    // if ($parentForm) {
    //   return $parentForm.querySelector(`[name='g-recaptcha-response']`)
    // }
    // Not all reCAPTCHAs are in forms
    // https://github.com/berstend/puppeteer-extra/issues/57
    if (document && document.body) {
      return document.body.querySelector(`input[id='cf-chl-widget-${id}_response']`)
    }
  }

  private isInvisible(id?: string) {
    if (!id) return false
    // const selector = `iframe[src*="/recaptcha/"][src*="/anchor"][name="a-${id}"][src*="&size=invisible"]`
    // return document.querySelectorAll(selector).length > 0
    return false
  }

  /** Check if an element is in the current viewport */
  private _isInViewport(elem: any) {
    const rect = elem.getBoundingClientRect()
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
      (window.innerHeight ||
        (document.documentElement.clientHeight &&
          rect.right <=
          (window.innerWidth || document.documentElement.clientWidth)))
    )
  }

  private isInViewport(id?: string) {
    if (!id) return
    const elem = document.querySelector(`iframe[id*="cf-chl-widget-${id}"]`)
    if (!elem) {
      return false
    }
    return this._isInViewport(elem)
  }

  private _extractInfoFromIframes(iframes: HTMLIFrameElement[]) {
    return iframes
      .map(el => {
        let idChunks = el.id.split('-')
        const id = idChunks.pop()

        let urlChunks = el.src.split('/')
        urlChunks.pop() // size: 'normal', 'compact' or 'invisible'
        urlChunks.pop() // theme: 'light', 'dark' or 'auto'
        const sitekey = urlChunks.pop()

        const $input = this.getResponseInputById(id)

        const result: types.CaptchaInfo = {
          _vendor: 'turnstile',
          _type: 'checkbox',
          url: document.location.href,
          id,
          sitekey,
          hasResponseElement: !!$input,
          isInvisible: this.isInvisible(id),
          isInViewport: this.isInViewport(id),
        }
        return result
      })
  }

  public async findRecaptchas() {
    const result = {
      captchas: [] as types.CaptchaInfo[],
      error: null as null | Error
    }
    try {
      await this._waitUntilDocumentReady()
      const iframes = this._findRegularCheckboxes()
      if (!iframes.length) {
        return result
      }
      result.captchas = this._extractInfoFromIframes(iframes)
      iframes.forEach(el => {
        this._paintCaptchaBusy(el)
      })
    } catch (error) {
      result.error = error
      return result
    }
    return result
  }

  public async enterRecaptchaSolutions() {
    const result = {
      solved: [] as types.CaptchaSolved[],
      error: null as any
    }
    try {
      await this._waitUntilDocumentReady()

      const solutions = this.data.solutions
      if (!solutions || !solutions.length) {
        result.error = 'No solutions provided'
        return result
      }
      result.solved = solutions
        .filter(solution => solution._vendor === 'turnstile')
        .filter(solution => solution.hasSolution === true)
        .map(solution => {
          //       window.postMessage(
          //         JSON.stringify({
          //           id: solution.id,
          //           label: 'challenge-closed',
          //           source: 'hcaptcha',
          //           contents: {
          //             event: 'challenge-passed',
          //             expiration: 120,
          //             response: solution.text
          //           }
          //         }),
          //         '*'
          //       )

          this.getResponseInputById(solution.id).value = solution.text
          // document.querySelector<HTMLFormElement>('#challenge-form').submit()
          // console.log('getResponseInputById', this.getResponseInputById(solution.id))

          return {
            _vendor: solution._vendor,
            id: solution.id,
            isSolved: true,
            solvedAt: new Date()
          }
        })
    } catch (error) {
      result.error = error
      return result
    }
    return result
  }
}
