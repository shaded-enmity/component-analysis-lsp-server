/* --------------------------------------------------------------------------------------------
 * Copyright (c) Pavel Odvody 2016
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import { IDependency } from './collector';
import { get_range } from './utils';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'

/* Descriptor describing what key-path to extract from the document */
interface IBindingDescriptor
{
    path: Array<string>;
};

/* Bind & return the part of `obj` as described by `desc` */
let bind_object = (obj: any, desc: IBindingDescriptor) => {
    let bind = obj;
    for (let elem of desc.path) {
        if (elem in bind) {
            bind = bind[elem];
        } else {
            return null;
        }
    }
    return bind;
};

/* Arbitrary metadata consumer interface */
interface IConsumer
{
    binding: IBindingDescriptor;
    item: any;
    consume(data: any): boolean;
};

/* Generic `T` producer */
interface IProducer<T>
{
    produce(): T;
};

/* Each pipeline item is defined as a single consumer and producer pair */
interface IPipelineItem<T> extends IConsumer, IProducer<T> {}; 

/* House bunches of `IPipelineItem`'s */
interface IPipeline<T>
{
    items: Array<IPipelineItem<T>>;
    run(data: any): T;
};

/* Diagnostics producer type */
type DiagnosticProducer = IProducer<Diagnostic[]>;

/* Diagnostics pipeline implementation */
class DiagnosticsPipeline implements IPipeline<Diagnostic[]>
{
    items: Array<IPipelineItem<Diagnostic[]>>;
    dependency: IDependency;
    config: any;
    diagnostics: Array<Diagnostic>;
    constructor(classes: Array<any>, dependency: IDependency, config: any, diags: Array<Diagnostic>) {
        this.items = classes.map((i) => { return new i(dependency, config); });
        this.dependency = dependency;
        this.config = config;
        this.diagnostics = diags;
    }

    run(data: any): Diagnostic[] {
        for (let item of this.items) {
            if (item.consume(data)) {
                for (let d of item.produce())
                    this.diagnostics.push(d);
            }
        }
        return this.diagnostics;
    }
};

/* A consumer that uses the binding interface to consume a metadata object */
class AnalysisConsumer implements IConsumer
{
    binding: IBindingDescriptor;
    item: any;
    constructor(public config: any){}
    consume(data: any): boolean {
        if (this.binding != null) {
            this.item = bind_object(data, this.binding);
        } else {
            this.item = data;
        }
        return this.item != null;
    }
};

/* We've received an empty/unfinished result, display that analysis is pending */
class EmptyResultEngine extends AnalysisConsumer implements DiagnosticProducer
{
    constructor(public context: IDependency, config: any) {
        super(config);
    }

    produce(): Diagnostic[] {
        if (this.item == {} || 
            this.item.finished_at === undefined ||
            this.item.finished_at == null) {
            return [{
                severity: DiagnosticSeverity.Information,
                range: get_range(this.context.version),
                message: `Package ${this.context.name.value}-${this.context.version.value} - analysis is pending`,
                source: 'Component Analysis'
            }]
        } else {
            return [];
        }
    }   
}

/* Report CVEs in found dependencies */
class SecurityEngine extends AnalysisConsumer implements DiagnosticProducer
{
    constructor(public context: IDependency, config: any){
        super(config);
        this.binding = {path: ['analyses', 'security_issues', 'summary']};
    }

    produce(): Diagnostic[] {
        if (this.item.length > 0) {
            let cves = this.item.join('\n-');
            return [{
                severity: DiagnosticSeverity.Error,
                range: get_range(this.context.version),
                message: `Package ${this.context.name.value}-${this.context.version.value} is vulnerable:\n-${cves}`,
                source: 'Component Analysis'
            }]
        } else {
            return [];
        }
    }
};

/* Report forbidden licenses found in dependencies */
class LicenseEngine extends AnalysisConsumer implements DiagnosticProducer
{
    constructor(public context: IDependency, config: any){
        super(config);
        this.binding = {path: ['analyses', 'source_licenses', 'summary', 'sure_licenses']};
    }

    produce(): Diagnostic[] {
        if (this.item.length > 0) {
            let data = [];
            for (let frb of this.config.forbidden_licenses) {
                if (this.item.indexOf(frb) > -1) {
                    data.push({
                        severity: DiagnosticSeverity.Error,
                        range: get_range(this.context.version),
                        message: `Package ${this.context.name.value}-${this.context.version.value} has a bad license:\r-${frb}`,
                        source: 'Component Analysis'
                    });
                }
            }
            return data;
        } else {
            return [];
        }
    }
};

/* Report custom cryptography implementations in dependencies */
class CryptoEngine extends AnalysisConsumer implements DiagnosticProducer
{
    constructor(public context: IDependency, config: any){
        super(config);
        this.binding = {path: ['analyses', 'crypto_algorithms', 'summary', 'content']};
    }

    produce(): Diagnostic[] {
        if (this.item.length > 0) {
            let algos = this.item.map((i) => { return i.name; }).join('\r-');
            return [{
                severity: DiagnosticSeverity.Error,
                range: get_range(this.context.version),
                message: `Package ${this.context.name.value}-${this.context.version.value} contains cryptography:\r-${algos}`,
                source: 'Component Analysis'
            }];
        } else {
            return [];
        }
    }
};

export { DiagnosticsPipeline, CryptoEngine, LicenseEngine, SecurityEngine, EmptyResultEngine };