# FHIR Profile Registry

## Versioning and Pinning

- Profiles are **pinned** per FHIR version (e.g. `r4/`) to avoid runtime dependency on external profile URLs.
- All validation uses these local profile definitions; **no runtime fetch** of `hl7.org` or other external URLs.
- To support a new FHIR version (e.g. R5), add a new folder (e.g. `r5/`) and copy or adapt profile JSON files.
- Profile files are referenced by **profile name** and **FHIR version** in validators and mappers.

## Layout

- `r4/` — HL7 FHIR R4 (4.0.1) profiles
- Add `r5/` when extending to R5.

## Usage

Validators and mappers accept `profileName` (e.g. `Patient`, `Observation`) and `fhirVersion` (e.g. `r4`) to resolve the correct profile.
