/* eslint-disable no-console */
import { FhirTransformationService } from './services/fhir-transformation.service';
import util from 'util';
async function run() {
  const canonical ={
    "userInfo": {
      "name": "anil kumar",
      "namePrefix": "Dr",
      "profilePic": "",
      "licenseNumber": "4545667768",
      "contact": {
        "email": "anil.kumar.011@yopmail.com",
        "phone": "7654566651",
        "phoneCode": "+91"
      },
      
      "dateOfBirth": "2004-03-11",
      "gender": "Male",
      "specialty": "general",
      "slotDurationInMinutes": 15,
      "bio": "gfhghhghjhjgf"
    },
    "userRole": [
      "04a9f451-a93b-4889-85c3-877b443df639"
    ],
    "userType": "STAFF",
    "organizationID": "mm1usge33d4f9b61"
  }

  const service = new FhirTransformationService();

  const fhir = await service.transformCanonicalToFhir(
    'Patient',

    canonical,
  );

  console.info(
    util.inspect(
      fhir,
      {
        depth: null,
        colors: true
      }
    )
  );

  const reverse = await service.transformFhirToCanonical(
    'Patient',

    fhir,
  );

  console.error(
    util.inspect(
      reverse,
      {
        depth: null,
        colors: true
      }
    )
  );
}

run();
