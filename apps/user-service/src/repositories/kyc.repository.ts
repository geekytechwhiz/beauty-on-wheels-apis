import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class KycRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    KycRepository;

export function getKycRepository() {

    if (!repository) {

        repository =
            new KycRepository();

    }

    return repository;

}
