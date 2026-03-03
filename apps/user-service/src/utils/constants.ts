export const PATH_ASSIGN_DOCTOR = '/user/assign-doctor';
export const PATH_DOCTOR_PATIENT_LIST = '/user/doctor-patient-list'; 
export const PATH_FNF_SEARCH = '/user/friend-family/search';
export const PATH_FNF_ADD = '/user/friend-family/add-member';
export const PATH_FNF_UPDATE = '/user/friend-family/update';
export const PATH_FNF_FETCH = '/user/friend-family/fetch';
export const PATH_FNF_DELETE = '/user/friend-family/delete';
export const PATH_LOGOUT_REQUIRED = '/user/{userId}/organization/{organizationId}/logout-required';
export const PATH_FNF_CHECK = '/user/friend-family/check';
export const PATH_ASSIGNED_PACKAGES = '/user/{userId}/organization/{organizationId}/assigned-packages';
export const PATH_V2_USER_LIST = '/v2/user/list';
export const WELCOME_MESSAGE = 'Welcome to {{ORG_NAME}}. Your account has been created. Thank you for MyVitalRx.';

// Email templates and messages
export const INVITE_EMAIL_SUBJECT = 'Welcome to Component Backend.';
export const INVITE_EMAIL_MESSAGE = `
\tHello,
    <br> <br> You have been invited to join the backend component project. Your temporary credentials have been created.
    <br> <br>You can log in with {{USER_EMAIL}}
\t<br> <br>Please use the above login credential to access the component project.<br><br>
\tIf you are unable to access the link above, please copy and paste the URL below directly into your browser:
\t<br> <br>URL: <a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}" target="_blank">{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}</a>
\t<br><br>
    {{CURRENT_YEAR}}<br><br>
    This email message was sent from a notification-only address that cannot accept incoming email. Do not reply to this message.
`;
export const SUCCESS_MESSAGE = 'Invitation sent successfully';
export const SMS_MESSAGE = `You have been invited to join the backend component project. Your temporary credentials have been created.
 You can log in with {{USER_PHONE_NUMBER}}
 Please use the above login credential to access the component project
 Click on the URL: <a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{HOSPITAL_ID}}&source={{TYPE}}{{DEVICE}}" target="_blank">{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}</a>`;
export const POST = 'post';
export const ROLE = 'ROLE';
export const STAFF_WELCOME_EMAIL_SUBJECT = "Welcome to {{ORG_NAME}}'s Portal, {{STAFF_FIRST_NAME}}";
export const STAFF_WELCOME_EMAIL_BODY = `Dear {{STAFF_FIRST_NAME}},
<br><br>We are pleased to welcome you to {{ORG_NAME}}'s web portal. To begin using the portal, please sign in by clicking the link below:
<br><br><a href="{{PORTAL_LINK}}" style="color: blue; font-weight:bold" target="_blank">{{PORTAL_LINK}}</a>
<br><br>As part of the sign-in process, you will receive a One-Time Password (OTP) in a separate email. Please use that OTP to sign in.
<br><br><b>First-Time Sign in Instructions:</b>
<ul>
<li>Click the link above to access the portal.</li>
<li>Enter your registered email address.</li>
<li>Check your inbox for the OTP email.</li>
<li>Enter the OTP when prompted to complete your sign in.</li>
</ul>
<br><br>The portal provides you with essential resources to streamline your work, save time and enhance efficiency. If you need any assistance or have any questions, please do not hesitate to contact us.
<br><br>Best regards,
<br><br>{{ORG_INFO}}
`;
export const STAFF_WELCOME_SMS = "Welcome to {{ORG_NAME}}'s Portal! To get started and access your account, please sign in using this link: {{PORTAL_LINK}}.";

export const USER_WELCOME_EMAIL_SUBJECT = 'Welcome to {{ORG_NAME}}, {{USER_FIRST_NAME}}!';
export const USER_WELCOME_EMAIL_BODY = `Dear {{USER_FIRST_NAME}},
<br><br>We welcome you to {{ORG_NAME}}, where your health and well-being are our top priorities. To get started and access our services, please sign in by clicking the link below:
<br><br><a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}" target="_blank" style="color: blue; font-weight:bold">Download here</a>
<br><br>Our entire medical team is committed to providing you with personalized and compassionate care. If you have any questions or need assistance, please do not hesitate to contact us.
<br><br>We look forward to being your trusted partner in health.
<br><br>Warm regards,
<br><br>{{ORG_INFO}}
`;
export const USER_WELCOME_SMS = 'Welcome to {{ORG_NAME}}! To get started and access our services, please sign in using this link: {{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}';

export const FNF_WELCOME_EMAIL_SUBJECT = "You've been added to {{USER_NAME}}'s healthcare circle at {{ORG_NAME}}!";
export const FNF_WELCOME_EMAIL_BODY = `Dear {{FNF_FIRST_NAME}},
<br><br>{{USER_NAME}} has added you to their healthcare circle at {{ORG_NAME}}. This means that now you can be more involved in their healthcare journey as a valued member of their support network.
<br><br>To get started, please download MyVitalRx app using the link below:
<br><br><a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}" target="_blank" style="color: blue; font-weight:bold">Download here</a>
<br><br>We understand the importance of having a strong support system during times of medical care, and we are here to ensure you have all the necessary resources to support {{USER_NAME}}.
<br><br>If you have any questions or need assistance, please don't hesitate to reach out to us.
<br><br>Warm regards,
<br><br>{{ORG_INFO}}`;
export const FNF_WELCOME_SMS = '{{USER_NAME}} has added you to their healthcare circle at {{ORG_NAME}}. Be involved in their care journey by downloading the MyVitalRx app: {{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}.';