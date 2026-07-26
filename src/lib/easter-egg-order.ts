import {
    createOrderAccessToken,
    hashOrderAccessToken,
    type OrderAccessTokenPair,
} from "./order-access-token";

export type EasterEggUploadTokenPair = OrderAccessTokenPair;

export const hashEasterEggUploadToken = hashOrderAccessToken;
export const createEasterEggUploadToken = createOrderAccessToken;
