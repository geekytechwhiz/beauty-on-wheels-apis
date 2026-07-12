import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class VendorsRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    VendorsRepository;

export function getVendorsRepository() {

    if (!repository) {

        repository =
            new VendorsRepository();

    }

    return repository;

}
