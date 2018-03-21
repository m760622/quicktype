"use strict";

import { assertNever } from "./Support";

export enum ErrorMessage {
    Foo = 1
}

export type Message = ErrorMessage;

export enum ErrorMessageWithInfo {
    RefWithFragmentNotAllowed = 1000
}

export type MessageWithInfo = ErrorMessageWithInfo;

export function messageAssert(assertion: boolean, message: Message): void;
export function messageAssert(assertion: boolean, message: MessageWithInfo, info: string): void;
export function messageAssert(assertion: boolean, message: number, info?: string): void {
    if (assertion) return;

    let str = stringForMessage(message);
    if (info !== undefined) {
        str = str.replace("%s", info);
    }
    throw str;
}

function stringForMessage(message: Message | MessageWithInfo): string {
    switch (message) {
        case ErrorMessage.Foo:
            return "Foo";
        case ErrorMessageWithInfo.RefWithFragmentNotAllowed:
            return "Ref URI with fragment is not allowed: %s";
        default:
            return assertNever(message);
    }
}
