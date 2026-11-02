/**
 * Kam's real background. Every Claude prompt in Scoutline is limited to these facts, so cover letters
 * and answers never invent experience. Edit this file when something new is true.
 */
export const CANDIDATE_NAME = "Kamdon Basinger";

export const FACTS: string[] = [
  "ERP / Software Developer at Geoprobe Systems, an equipment manufacturer, for over three years. Worked with Finance, Engineering, Production, Purchasing, Distribution and Service.",
  "SAP ECC: supported and administered it; Materials Management (materials data, purchasing, engineering data); developed and modified ABAP programs; integrations with BAPIs, IDocs and RFCs; SAP BusinessObjects Web Intelligence and Data Services (BODS).",
  "Helped move the company from SAP ECC to Epicor Kinetic: database table mapping, data validation, workflow testing, configuration, custom development.",
  "Epicor Kinetic: BPMs, BAQs, Functions, Application Studio customizations; built and customized company reports and documents in SSRS.",
  "SQL Server and T-SQL daily, plus PostgreSQL; ERP database administration and data troubleshooting.",
  "Power BI dashboards for employee time, work orders, work order hour variance, engineering change notices and lead times.",
  "CenterpointConnected: built from scratch with one other developer over about seven months; brought orders, quotes, service logs, serialized equipment, tracking and internal service notes into one portal; replaced an older SAP-integrated portal; employee inquiries dropped about 40%. He handled SQL and a large share of the front end (TypeScript, JavaScript, HTML, CSS).",
  "Internal SAP reporting / project request application that cut SAP report generation time by more than 80%.",
  "Paperless employee onboarding application with SQL-based permissions and employee history.",
  "Independently built scheduled integrations that pulled data from other systems over REST APIs, with authentication and JSON/XML.",
  "Languages and frameworks: C#, TypeScript, JavaScript, Java, Node.js, React, Vue.js, HTML/CSS.",
  "Active Directory security groups and application permissions, Microsoft Intune device setup, ERP help desk support, analyzed help desk ticket data to find recurring issues, trained employees on SAP ECC and Epicor Kinetic.",
  "Service inventory, replacement parts, serialized equipment tracking, warranty parts and inventory transfers.",
  "BS in Computer Science, Fort Hays State University (2025, earned while working as a developer); AS, Hutchinson Community College; earlier, Best Buy computer department sales.",
  "Built Scoutline, a Next.js, TypeScript and PostgreSQL app that pulls job postings from company job board APIs on a schedule, de-duplicates them in the database, and tracks applications.",
];

export const TARGETS =
  "He wants ERP / SAP / Epicor developer or analyst roles, business systems analyst or engineer, integration / SQL / BI developer, ERP application support, and .NET or full-stack roles, ideally at manufacturers or companies running an ERP. Not senior, lead, staff, principal, architect or manager roles. Remote in the US, or hybrid/onsite in the San Francisco Bay Area, where he lives.";

export const factsText = () => FACTS.map((f) => "- " + f).join("\n");
