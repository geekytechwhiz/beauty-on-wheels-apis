import {
    IdentityRepository
} from "./identity.repository";

import {
    env
} from "../configs/env.config";

export class RegistrationRepository
    extends IdentityRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    RegistrationRepository;

export function getRegistrationRepository() {

    if (!repository) {

        repository =
            new RegistrationRepository();

    }

    return repository;

}
