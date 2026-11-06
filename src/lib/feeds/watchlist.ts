import type { Ats } from "./types";

/**
 * Starter watch list: Bay Area and remote-friendly employers that hire business systems, ERP,
 * integration, application and R&D software people and post on Greenhouse, Lever, Ashby,
 * SmartRecruiters, Workable or Workday. Big ERP shops (manufacturers, chipmakers, biotech, energy) mostly use
 * Workday, so those boards are searched for your kinds of work rather than read in full.
 * Board names were chosen from each company's public job board address. The first check tests
 * every one and switches off any that don't exist, so this list can be trimmed safely.
 */
export type StarterCompany = { name: string; ats: Ats; board: string; category: string };

/**
 * Smaller and mid-size companies (added Nov 6 2026): Bay Area or remote-friendly manufacturers and
 * hardware makers that run an ERP, plus software companies that build ERP, inventory, manufacturing,
 * integration, procurement and accounting tools. Every board below was checked live on Nov 6 2026.
 * These can be added on their own from the Watch list page, so companies you removed earlier stay removed.
 */
export const SMALLER_COMPANIES: StarterCompany[] = [
  // Smaller manufacturers and hardware makers
  { name: "Fictiv", ats: "greenhouse", board: "fictiv", category: "Smaller manufacturers" },
  { name: "Bright Machines", ats: "lever", board: "brightmachines", category: "Smaller manufacturers" },
  { name: "Dexterity", ats: "lever", board: "dexterity", category: "Smaller manufacturers" },
  { name: "Mainspring Energy", ats: "lever", board: "mainspringenergy", category: "Smaller manufacturers" },
  { name: "Form Energy", ats: "ashby", board: "formenergy", category: "Smaller manufacturers" },
  { name: "SPAN", ats: "ashby", board: "span", category: "Smaller manufacturers" },
  { name: "Redwood Materials", ats: "greenhouse", board: "redwoodmaterials", category: "Smaller manufacturers" },
  { name: "Skydio", ats: "ashby", board: "skydio", category: "Smaller manufacturers" },
  { name: "Lightmatter", ats: "greenhouse", board: "lightmatter", category: "Smaller manufacturers" },
  { name: "PsiQuantum", ats: "greenhouse", board: "psiquantum", category: "Smaller manufacturers" },
  { name: "Tenstorrent", ats: "greenhouse", board: "tenstorrent", category: "Smaller manufacturers" },
  { name: "Outset Medical", ats: "greenhouse", board: "outsetmedical", category: "Smaller manufacturers" },
  { name: "Twist Bioscience", ats: "greenhouse", board: "twistbioscience", category: "Smaller manufacturers" },
  { name: "Oura", ats: "greenhouse", board: "oura", category: "Smaller manufacturers" },
  // Manufacturing, inventory and ERP software
  { name: "Fulcrum", ats: "lever", board: "fulcrumpro", category: "Manufacturing and ERP software" },
  { name: "Cin7", ats: "lever", board: "cin7", category: "Manufacturing and ERP software" },
  { name: "Doss", ats: "ashby", board: "doss", category: "Manufacturing and ERP software" },
  { name: "Rillet", ats: "ashby", board: "rillet", category: "Manufacturing and ERP software" },
  { name: "Campfire", ats: "ashby", board: "campfire", category: "Manufacturing and ERP software" },
  { name: "Tulip Interfaces", ats: "greenhouse", board: "tulip", category: "Manufacturing and ERP software" },
  { name: "Paperless Parts", ats: "greenhouse", board: "paperlessparts", category: "Manufacturing and ERP software" },
  { name: "First Resonance", ats: "ashby", board: "first-resonance", category: "Manufacturing and ERP software" },
  { name: "Seeq", ats: "workable", board: "seeq", category: "Manufacturing and ERP software" },
  { name: "Xometry", ats: "greenhouse", board: "xometry", category: "Manufacturing and ERP software" },
  // Integration, data and finance / procurement software
  { name: "Celigo", ats: "greenhouse", board: "celigo", category: "Integration and finance software" },
  { name: "Workato", ats: "greenhouse", board: "workato", category: "Integration and finance software" },
  { name: "Merge", ats: "ashby", board: "merge", category: "Integration and finance software" },
  { name: "Omni Analytics", ats: "ashby", board: "omni", category: "Integration and finance software" },
  { name: "Numeric", ats: "ashby", board: "numeric", category: "Integration and finance software" },
  { name: "Mercury", ats: "greenhouse", board: "mercury", category: "Integration and finance software" },
  { name: "Zip", ats: "ashby", board: "zip", category: "Integration and finance software" },
  { name: "Levelpath", ats: "ashby", board: "levelpath", category: "Integration and finance software" },
  { name: "Procurify", ats: "ashby", board: "procurify", category: "Integration and finance software" },
  { name: "Fairmarkit", ats: "greenhouse", board: "fairmarkit", category: "Integration and finance software" },
  { name: "Didero", ats: "ashby", board: "didero", category: "Integration and finance software" },
];

export const STARTER_WATCHLIST: StarterCompany[] = [
  // Hardware, manufacturing and R&D
  { name: "Samsara", ats: "greenhouse", board: "samsara", category: "Hardware / IoT" },
  { name: "Verkada", ats: "greenhouse", board: "verkada", category: "Hardware / IoT" },
  { name: "Astranis", ats: "greenhouse", board: "astranis", category: "Manufacturing / aerospace" },
  { name: "Zipline", ats: "greenhouse", board: "flyzipline", category: "Manufacturing / aerospace" },
  { name: "Nuro", ats: "greenhouse", board: "nuro", category: "Autonomous vehicles" },
  { name: "Zoox", ats: "lever", board: "zoox", category: "Autonomous vehicles" },
  { name: "Formlabs", ats: "greenhouse", board: "formlabs", category: "Manufacturing / 3D printing" },
  { name: "1X Technologies", ats: "ashby", board: "1x", category: "Robotics" },
  { name: "Cerebras Systems", ats: "ashby", board: "cerebras", category: "Semiconductors" },
  { name: "Benchling", ats: "ashby", board: "benchling", category: "Life science software" },
  { name: "Industrial Electric Mfg", ats: "greenhouse", board: "industrialelectricmanufacturing", category: "Manufacturing" },
  { name: "Loenbro", ats: "greenhouse", board: "loenbro", category: "Industrial services" },
  { name: "Flexport", ats: "greenhouse", board: "flexport", category: "Supply chain" },
  { name: "Faire", ats: "greenhouse", board: "faire", category: "Wholesale / supply chain" },
  // Companies with business systems / finance systems teams
  { name: "Anthropic", ats: "greenhouse", board: "anthropic", category: "Business systems teams" },
  { name: "OpenAI", ats: "ashby", board: "openai", category: "Business systems teams" },
  { name: "Notion", ats: "ashby", board: "notion", category: "Business systems teams" },
  { name: "Ramp", ats: "ashby", board: "ramp", category: "Business systems teams" },
  { name: "Harvey", ats: "ashby", board: "harvey", category: "Business systems teams" },
  { name: "Vercel", ats: "ashby", board: "vercel", category: "Business systems teams" },
  { name: "Linear", ats: "ashby", board: "linear", category: "Business systems teams" },
  { name: "Deel", ats: "ashby", board: "deel", category: "Business systems teams" },
  { name: "Stripe", ats: "greenhouse", board: "stripe", category: "Business systems teams" },
  { name: "Databricks", ats: "greenhouse", board: "databricks", category: "Business systems teams" },
  { name: "Figma", ats: "greenhouse", board: "figma", category: "Business systems teams" },
  { name: "Airbnb", ats: "greenhouse", board: "airbnb", category: "Business systems teams" },
  { name: "Lyft", ats: "greenhouse", board: "lyft", category: "Business systems teams" },
  { name: "Pinterest", ats: "greenhouse", board: "pinterest", category: "Business systems teams" },
  { name: "Dropbox", ats: "greenhouse", board: "dropbox", category: "Business systems teams" },
  { name: "Asana", ats: "greenhouse", board: "asana", category: "Business systems teams" },
  { name: "Instacart", ats: "greenhouse", board: "instacart", category: "Business systems teams" },
  { name: "Affirm", ats: "greenhouse", board: "affirm", category: "Business systems teams" },
  { name: "Gusto", ats: "greenhouse", board: "gusto", category: "Business systems teams" },
  { name: "Brex", ats: "greenhouse", board: "brex", category: "Business systems teams" },
  { name: "Robinhood", ats: "greenhouse", board: "robinhood", category: "Business systems teams" },
  { name: "Chime", ats: "greenhouse", board: "chime", category: "Business systems teams" },
  { name: "Twilio", ats: "greenhouse", board: "twilio", category: "Business systems teams" },
  { name: "Discord", ats: "greenhouse", board: "discord", category: "Business systems teams" },
  { name: "Reddit", ats: "greenhouse", board: "reddit", category: "Business systems teams" },
  { name: "Okta", ats: "greenhouse", board: "okta", category: "Business systems teams" },
  { name: "Airtable", ats: "greenhouse", board: "airtable", category: "Business systems teams" },
  { name: "Scale AI", ats: "greenhouse", board: "scaleai", category: "Business systems teams" },
  // Large employers with SAP / Oracle / ERP teams (Workday boards are stored as "tenant.wdN/site")
  { name: "NVIDIA", ats: "workday", board: "nvidia.wd5/NVIDIAExternalCareerSite", category: "Large employers with ERP teams" },
  { name: "Salesforce", ats: "workday", board: "salesforce.wd12/External_Career_Site", category: "Large employers with ERP teams" },
  { name: "Intel", ats: "workday", board: "intel.wd1/External", category: "Large employers with ERP teams" },
  { name: "Applied Materials", ats: "workday", board: "amat.wd1/External", category: "Large employers with ERP teams" },
  { name: "HP", ats: "workday", board: "hp.wd5/ExternalCareerSite", category: "Large employers with ERP teams" },
  { name: "Adobe", ats: "workday", board: "adobe.wd5/external_experienced", category: "Large employers with ERP teams" },
  { name: "Workday", ats: "workday", board: "workday.wd5/Workday", category: "Large employers with ERP teams" },
  { name: "Cadence Design Systems", ats: "workday", board: "cadence.wd1/External_Careers", category: "Large employers with ERP teams" },
  { name: "Gilead Sciences", ats: "workday", board: "gilead.wd1/gileadcareers", category: "Large employers with ERP teams" },
  { name: "Illumina", ats: "workday", board: "illumina.wd1/illumina-careers", category: "Large employers with ERP teams" },
  { name: "Chevron", ats: "workday", board: "chevron.wd5/jobs", category: "Large employers with ERP teams" },
  { name: "Motorola Solutions", ats: "workday", board: "motorolasolutions.wd5/Careers", category: "Large employers with ERP teams" },
  { name: "Mastercard", ats: "workday", board: "mastercard.wd1/CorporateCareers", category: "Large employers with ERP teams" },
  { name: "Visa", ats: "smartrecruiters", board: "Visa", category: "Large employers with ERP teams" },
  { name: "ServiceNow", ats: "smartrecruiters", board: "ServiceNow", category: "Large employers with ERP teams" },
  { name: "Bosch", ats: "smartrecruiters", board: "BoschGroup", category: "Large employers with ERP teams" },
  // Broad search: job sites that list many employers, searched for your kinds of work (terms in feeds/search.ts)
  { name: "USAJOBS (federal jobs search)", ats: "usajobs", board: "search", category: "Broad search" },
  { name: "Remotive (remote jobs search)", ats: "remotive", board: "search", category: "Broad search" },
  { name: "Jobicy (remote jobs search)", ats: "jobicy", board: "search", category: "Broad search" },
  // ERP and NetSuite consultancies
  { name: "Beyond Cloud Consulting", ats: "lever", board: "beyondcloudconsulting", category: "ERP consultancy" },
  // Smaller and mid-size companies (see above)
  ...SMALLER_COMPANIES,
];
