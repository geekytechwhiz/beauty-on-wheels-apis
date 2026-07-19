import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class StaffRepository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    StaffRepository;

export function getStaffRepository() {

    if (!repository) {

        repository =
            new StaffRepository();

    }

    return repository;

}
