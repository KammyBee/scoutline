import type { Ats } from "./types";

/**
 * Starter watch list: Bay Area and remote-friendly employers that hire business systems, ERP,
 * integration, application and R&D software people and post on Greenhouse, Lever or Ashby.
 * Board names were chosen from each company's public job board address. The first check tests
 * every one and switches off any that don't exist, so this list can be trimmed safely.
 */
export const STARTER_WATCHLIST: { name: string; ats: Ats; board: string; category: string }[] = [
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
  // ERP and NetSuite consultancies
  { name: "Beyond Cloud Consulting", ats: "lever", board: "beyondcloudconsulting", category: "ERP consultancy" },
];
