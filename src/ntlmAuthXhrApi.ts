import { FetchStream, fetchUrl } from 'fetch';
import * as  Promise from "bluebird";
import { createType1Message, decodeType2Message, createType3Message } from "@ewsjs/ntlm-client";
import { Agent as httpsAgent } from "https";
import { Agent as httpAgent } from "http";

import { setupXhrResponse } from "./utils";
import { IXHROptions, IXHRApi, IXHRProgress } from "./ews.partial";

/** @internal */
export class ntlmAuthXhrApi implements IXHRApi {

    private stream: FetchStream = null;
    private username: string = null;
    private password: string = null;
    private domain: string = '';
    private allowUntrustedCertificate: boolean;

    get apiName(): string {
        return "ntlm";
    }

    constructor(username: string, password: string, allowUntrustedCertificate: boolean = false) {

        this.username = username || '';
        this.password = password || '';
        this.allowUntrustedCertificate = allowUntrustedCertificate;

        if (username.indexOf("\\") > 0) {
            this.username = username.split("\\")[1];
            this.domain = username.split("\\")[0].toUpperCase();
        }
    }

    xhr(xhroptions: IXHROptions, progressDelegate?: (progressData: IXHRProgress) => void): Promise<XMLHttpRequest> {

        //setup xhr for github.com/andris9/fetch options
        let options = {
            url: xhroptions.url,
            //payload: xhroptions.data,
            headers: xhroptions.headers,
            method: 'GET',
            agentHttps: new httpsAgent({ keepAlive: true, rejectUnauthorized: !this.allowUntrustedCertificate }), //keepaliveAgent
            agentHttp: new httpAgent({ keepAlive: true }) //keepaliveAgent
        }

        return new Promise<XMLHttpRequest>((resolve, reject) => {

            this.ntlmPreCall(options).then((optionsWithNtlmHeader) => {

                optionsWithNtlmHeader['payload'] = xhroptions.data;
                optionsWithNtlmHeader['method'] = <any>xhroptions.type
                fetchUrl(xhroptions.url, optionsWithNtlmHeader, (error, meta, body) => {
                    if (error) {
                        reject(error);
                    }
                    else {
                        let xhrResponse: XMLHttpRequest = <any>{
                            response: body.toString(),
                            status: meta.status,
                            redirectCount: meta.redirectCount,
                            headers: meta.responseHeaders,
                            finalUrl: meta.finalUrl,
                            responseType: '',
                            statusText: undefined,
                        };
                        if (xhrResponse.status === 200) {
                            resolve(setupXhrResponse(xhrResponse));
                        }
                        else {
                            reject(setupXhrResponse(xhrResponse));
                        }
                    }
                });
            }, reject);
        })
    }

    xhrStream(xhroptions: IXHROptions, progressDelegate: (progressData: IXHRProgress) => void): Promise<XMLHttpRequest> {

        //setup xhr for github.com/andris9/fetch options
        let options = {
            url: xhroptions.url,
            //payload: xhroptions.data,
            headers: xhroptions.headers,
            method: 'GET',
            agentHttps: new httpsAgent({ keepAlive: true, rejectUnauthorized: !this.allowUntrustedCertificate }), //keepaliveAgent
            agentHttp: new httpAgent({ keepAlive: true }) //keepaliveAgent
        }

        return new Promise<XMLHttpRequest>((resolve, reject) => {
            this.ntlmPreCall(options).then((optionsWithNtlmHeader) => {

                optionsWithNtlmHeader['payload'] = xhroptions.data;
                optionsWithNtlmHeader['method'] = <any>xhroptions.type

                this.stream = new FetchStream(xhroptions.url, optionsWithNtlmHeader);

                this.stream.on("data", (chunk) => {
                    //console.log(chunk.toString());
                    progressDelegate({ type: "data", data: chunk.toString() });
                });

                this.stream.on("meta", (meta) => {
                    progressDelegate({ type: "header", headers: meta["responseHeaders"] });
                });

                this.stream.on("end", () => {
                    progressDelegate({ type: "end" });
                    resolve();
                });

                this.stream.on('error', (error) => {
                    progressDelegate({ type: "error", error: error });
                    this.disconnect();
                    reject(error);
                });
            }, reject);
        });
    }

    disconnect() {
        if (this.stream) {
            try {
                this.stream.destroy();
            }
            catch (e) { }
        }
    }

    private ntlmPreCall(options: IXHROptions, ) {
        let ntlmOptions = {
            url: options.url,
            username: this.username,
            password: this.password,
            workstation: options['workstation'] || '',
            domain: this.domain
        };

        return new Promise<XMLHttpRequest>((resolve, reject) => {

            let type1msg = createType1Message(ntlmOptions.workstation, ntlmOptions.domain);

            options.headers['Authorization'] = type1msg;
            options.headers['Connection'] = 'keep-alive';

            fetchUrl(options.url, options, (error, meta, body) => {
                if (error) {
                    reject(error);
                }
                else {
                    let xhrResponse: XMLHttpRequest = <any>{
                        response: body,
                        status: meta.status,
                        redirectCount: meta.redirectCount,
                        headers: meta.responseHeaders,
                        finalUrl: meta.finalUrl,
                        responseType: '',
                        statusText: undefined,
                    };
                    resolve(xhrResponse);
                }
            });
        }).then((res: any) => {
            if (!res.headers['www-authenticate'])
                throw new Error('www-authenticate not found on response of second request');

            let type2msg = decodeType2Message(res.headers['www-authenticate']);
            let type3msg = createType3Message(type2msg, ntlmOptions.username, ntlmOptions.password, ntlmOptions.workstation, ntlmOptions.domain); //with ntlm-client

            delete options.headers['authorization'] // 'fetch' has this wired addition with lower case, with lower case ntlm on server side fails
            delete options.headers['connection'] // 'fetch' has this wired addition with lower case, with lower case ntlm on server side fails

            options.headers['Authorization'] = type3msg;
            options.headers['Connection'] = 'Close';

            return options;
        });
    }
}
