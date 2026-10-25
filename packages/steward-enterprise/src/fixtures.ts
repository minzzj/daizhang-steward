/**
 * 内置虚构企业/个人档案（演示与验收用；**不是真实公司、不是真实客户**）。
 *
 * - 主体名称、统一社会信用代码、银行账号、授权书/用印签署人全部为虚构示例；
 * - 银行账号只保留掩码，不含完整账号；
 * - 真实使用时必须替换为有合法授权的真实主体，并按企业合规流程完成人签与用印。
 */

import type { BusinessEntity, EnterpriseProfile } from "./types.js";

/** 个人模式主体（虚构）；用于 B8 个人模式订单。 */
export const DEFAULT_PERSONAL_ENTITY: BusinessEntity = {
  id: "ent-personal-demo",
  kind: "individual",
  name: "个人经营者（虚构）",
  bank_account: {
    account_name: "个人经营者（虚构）",
    account_no_masked: "**** **** 6666",
    bank_name: "示例银行（虚构）",
    type: "personal",
  },
  scope: "个人服务：软件咨询、数据整理、内容排版（无需经营许可）",
};

/** 企业模式默认档案（虚构）；默认开票类型为增值税专票。
 *  字段值与 `examples/demo-enterprise/enterprise.json` 保持一致（同一套虚构演示数据）。 */
export const DEFAULT_ENTERPRISE_PROFILE: EnterpriseProfile = {
  entity: {
    id: "ent-demo-001",
    kind: "company",
    name: "示例科技企业（虚构）",
    license_no: "91330100MA2DEMO01X（虚构统一社会信用代码）",
    legal_representative: "示例法人（虚构）",
    agent_name: "示例经办人（虚构）",
    authorization_letter: {
      status: "signed",
      signed_by: "示例法人（虚构，人签）",
      path: "evidence/authorization-letter.md",
    },
    seal: {
      status: "signed",
      signed_by: "示例法人（虚构，人签）",
    },
    bank_account: {
      account_name: "示例科技企业（虚构）",
      account_no_masked: "**** **** **** 8888",
      bank_name: "示例银行（虚构）",
      type: "corporate",
    },
    tax_no: "91330100MA2DEMO01X（虚构税号）",
    scope: "软件开发；数据处理；技术服务（不含需行政许可或行业资质的业务）",
  },
  invoice_defaults: {
    type: "vat_special",
    title: "示例科技企业（虚构）",
    tax_no: "91330100MA2DEMO01X（虚构税号）",
  },
  review_policy: {
    dual_review_threshold_cny: 5_000,
    dual_review_roles: ["finance", "legal"],
    approval_chain: ["示例经办人（虚构）", "示例财务负责人（虚构）", "示例法人（虚构）"],
  },
  seats: 5,
  multi_agent_serial: true,
};

/** 返回默认企业档案的深拷贝（调用方可安全修改后注入引擎）。 */
export function defaultEnterpriseProfile(): EnterpriseProfile {
  return JSON.parse(JSON.stringify(DEFAULT_ENTERPRISE_PROFILE)) as EnterpriseProfile;
}

/** 返回默认个人主体的深拷贝。 */
export function defaultPersonalEntity(): BusinessEntity {
  return JSON.parse(JSON.stringify(DEFAULT_PERSONAL_ENTITY)) as BusinessEntity;
}
