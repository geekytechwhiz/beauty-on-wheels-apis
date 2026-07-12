import {
    IdentityRepository
} from "./identity.repository";

import {
    env
} from "../configs/env.config";

export class OtpRepository
    extends IdentityRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    OtpRepository;

export function getOtpRepository() {

    if (!repository) {

        repository =
            new OtpRepository();

    }

    return repository;

}
