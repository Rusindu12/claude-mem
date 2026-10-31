import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /**
   * Computes comprehensive SaaS financial metrics with strict GAAP deferred-revenue accounting:
   * Unused purchased credits are recorded as Unearned Credit Liability (future service obligation)
   * and are NEVER counted as realized profit until consumed!
   */
  async getBusinessAnalytics() {
    const [
      paymentsAgg,
      walletsLiability,
      realizedCreditsAgg,
      activeSubsRows,
      aiUsageAgg,
      hostingSetting,
      userCountRes,
      dailySeriesRes,
      monthlySeriesRes,
      providerSpendRes,
    ] = await Promise.all([
      this.db.query<{
        gross_cash_usd: string;
        credit_sales_usd: string;
        sub_sales_usd: string;
        gateway_fees_usd: string;
        refunds_usd: string;
        succeeded_count: string;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED') THEN amount_usd ELSE 0 END), 0)::text AS gross_cash_usd,
          COALESCE(SUM(CASE WHEN status = 'SUCCEEDED' AND payment_type = 'CREDIT_PACKAGE' THEN amount_usd ELSE 0 END), 0)::text AS credit_sales_usd,
          COALESCE(SUM(CASE WHEN status = 'SUCCEEDED' AND payment_type = 'SUBSCRIPTION' THEN amount_usd ELSE 0 END), 0)::text AS sub_sales_usd,
          COALESCE(SUM(CASE WHEN status IN ('SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED') THEN gateway_fee_usd ELSE 0 END), 0)::text AS gateway_fees_usd,
          COALESCE(SUM(refunded_amount_usd), 0)::text AS refunds_usd,
          COUNT(CASE WHEN status = 'SUCCEEDED' THEN 1 END)::text AS succeeded_count
        FROM payments
      `),
      this.db.query<{
        unearned_usd: string;
        unspent_purchased_credits: string;
        unspent_bonus_credits: string;
      }>(`
        SELECT
          COALESCE(SUM(unearned_purchased_liability_usd), 0)::text AS unearned_usd,
          COALESCE(SUM(purchased_credits), 0)::text AS unspent_purchased_credits,
          COALESCE(SUM(bonus_credits), 0)::text AS unspent_bonus_credits
        FROM wallets
      `),
      this.db.query<{ realized_credit_usd: string }>(`
        SELECT COALESCE(SUM(realized_revenue_usd), 0)::text AS realized_credit_usd
        FROM wallet_transactions
        WHERE tx_type = 'SETTLE'
      `),
      this.db.query<{
        amount_paid_usd: string;
        current_period_start: string;
        current_period_end: string;
      }>(`
        SELECT amount_paid_usd, current_period_start, current_period_end
        FROM subscriptions
        WHERE status = 'ACTIVE'
      `),
      this.db.query<{
        ai_cost_usd: string;
        total_requests: string;
        total_tokens: string;
      }>(`
        SELECT
          COALESCE(SUM(provider_cost_usd), 0)::text AS ai_cost_usd,
          COUNT(*)::text AS total_requests,
          COALESCE(SUM(total_tokens), 0)::text AS total_tokens
        FROM ai_usage
      `),
      this.db.query<{ setting_value: any }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'finance.monthly_hosting_expense_usd'",
      ),
      this.db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM users'),
      this.db.query<{ day: string; cash_usd: string }>(
        `SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD') AS day,
                COALESCE(SUM(amount_usd - refunded_amount_usd), 0)::text AS cash_usd
         FROM payments
         WHERE status = 'SUCCEEDED'
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 14`,
      ),
      this.db.query<{ month: string; cash_usd: string }>(
        `SELECT TO_CHAR(created_at AT TIME ZONE 'Asia/Colombo', 'YYYY-MM') AS month,
                COALESCE(SUM(amount_usd - refunded_amount_usd), 0)::text AS cash_usd
         FROM payments
         WHERE status = 'SUCCEEDED'
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 12`,
      ),
      this.db.query(
        `SELECT p.code, p.name, p.health_status,
                b.current_day_spend_usd, b.daily_budget_limit_usd,
                b.current_month_spend_usd, b.monthly_budget_limit_usd,
                b.provider_reported_month_usd, b.reconciliation_drift_usd
         FROM ai_providers p
         LEFT JOIN provider_billing_accounts b ON b.provider_id = p.id
         ORDER BY p.priority ASC`,
      ),
    ]);

    const pRow = paymentsAgg.rows[0];
    const grossCashReceiptsUsd = Number(pRow.gross_cash_usd);
    const creditSalesUsd = Number(pRow.credit_sales_usd);
    const subscriptionSalesUsd = Number(pRow.sub_sales_usd);
    const paymentGatewayFeesUsd = Number(pRow.gateway_fees_usd);
    const refundsUsd = Number(pRow.refunds_usd);

    const unearnedCreditLiabilityUsd = Number(walletsLiability.rows[0].unearned_usd);
    const unspentPurchasedCredits = Number(walletsLiability.rows[0].unspent_purchased_credits);
    const realizedCreditRevenueUsd = Number(realizedCreditsAgg.rows[0].realized_credit_usd);

    // Pro-rata subscription revenue recognition vs unearned subscription obligation
    const nowMs = Date.now();
    let realizedSubRevenueUsd = 0;
    let unearnedSubLiabilityUsd = 0;
    for (const s of activeSubsRows.rows) {
      const paid = Number(s.amount_paid_usd);
      const startMs = new Date(s.current_period_start).getTime();
      const endMs = new Date(s.current_period_end).getTime();
      const totalSpan = Math.max(1, endMs - startMs);
      const elapsedRatio = Math.min(1, Math.max(0, (nowMs - startMs) / totalSpan));
      realizedSubRevenueUsd += paid * elapsedRatio;
      unearnedSubLiabilityUsd += paid * (1 - elapsedRatio);
    }

    const totalRealizedRevenueUsd = r4(realizedCreditRevenueUsd + realizedSubRevenueUsd);
    const totalDeferredObligationUsd = r4(unearnedCreditLiabilityUsd + unearnedSubLiabilityUsd);

    const aiApiExpensesUsd = Number(aiUsageAgg.rows[0].ai_cost_usd);
    const hostingExpensesUsd = Number(hostingSetting.rows[0]?.setting_value?.amount_usd ?? 85);

    // Accrual Gross Profit & Net Profit (strictly excluding unearned unused credits!)
    const grossProfitUsd = r4(
      totalRealizedRevenueUsd - aiApiExpensesUsd - paymentGatewayFeesUsd,
    );
    const netProfitUsd = r4(grossProfitUsd - hostingExpensesUsd);

    // Payment-Funded AI API Cost Deduction & Free-AI-Only Launch Mode
    const [fxRes, guardRes, freeModeRes] = await Promise.all([
      this.db.query<{ setting_value: any }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'finance.lkr_per_usd'",
      ),
      this.db.query<{ setting_value: any }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'finance.payment_funded_api_guard'",
      ),
      this.db.query<{ setting_value: any }>(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'platform.free_ai_only_mode'",
      ),
    ]);
    const lkrPerUsd = Number(fxRes.rows[0]?.setting_value?.rate ?? 300);
    const freeAiOnlyMode =
      freeModeRes.rowCount > 0 ? Boolean(freeModeRes.rows[0].setting_value?.enabled) : false;
    const guardCfg = guardRes.rows[0]?.setting_value || {
      enabled: false,
      reserveAllocationPercent: 35,
      initialFloatUsd: 0,
    };
    const netCashAfterFeesAndRefundsUsd = Math.max(
      0,
      r4(grossCashReceiptsUsd - refundsUsd - paymentGatewayFeesUsd),
    );
    const reserveAllocationPercent = Number(guardCfg.reserveAllocationPercent ?? 35);
    const initialFloatUsd = Number(guardCfg.initialFloatUsd ?? 0);
    const allocatedApiPoolFromPaymentsUsd = r4(
      initialFloatUsd + (netCashAfterFeesAndRefundsUsd * reserveAllocationPercent) / 100,
    );
    const remainingApiReserveUsd = r4(allocatedApiPoolFromPaymentsUsd - aiApiExpensesUsd);
    const netPayoutAfterApiDeductionUsd = r4(netCashAfterFeesAndRefundsUsd - aiApiExpensesUsd);

    return {
      accountingBasis: 'ACCRUAL_WITH_DEFERRED_CREDIT_LIABILITY',
      apiCostSettlementFromPayments: {
        freeAiOnlyMode,
        lkrPerUsd,
        strictPaymentGuardEnabled: Boolean(guardCfg.enabled),
        reserveAllocationPercent,
        initialFloatUsd: r2(initialFloatUsd),
        netPaymentsAfterGatewayFeesUsd: r2(netCashAfterFeesAndRefundsUsd),
        netPaymentsAfterGatewayFeesLkr: r2(netCashAfterFeesAndRefundsUsd * lkrPerUsd),
        allocatedApiBudgetFromPaymentsUsd: r4(allocatedApiPoolFromPaymentsUsd),
        allocatedApiBudgetFromPaymentsLkr: r2(allocatedApiPoolFromPaymentsUsd * lkrPerUsd),
        aiApiCostDeductedUsd: r4(aiApiExpensesUsd),
        aiApiCostDeductedLkr: r2(aiApiExpensesUsd * lkrPerUsd),
        remainingApiReserveUsd,
        remainingApiReserveLkr: r2(remainingApiReserveUsd * lkrPerUsd),
        ownerNetAfterApiCostUsd: r2(netPayoutAfterApiDeductionUsd),
        ownerNetAfterApiCostLkr: r2(netPayoutAfterApiDeductionUsd * lkrPerUsd),
      },
      summary: {
        grossCashReceiptsUsd: r2(grossCashReceiptsUsd),
        netCashAfterRefundsUsd: r2(grossCashReceiptsUsd - refundsUsd),
        creditSalesUsd: r2(creditSalesUsd),
        subscriptionSalesUsd: r2(subscriptionSalesUsd),
        refundsUsd: r2(refundsUsd),
        unearnedCreditLiabilityUsd: r4(unearnedCreditLiabilityUsd),
        unearnedSubscriptionLiabilityUsd: r4(unearnedSubLiabilityUsd),
        totalFutureServiceObligationUsd: totalDeferredObligationUsd,
        unspentPurchasedCredits: r2(unspentPurchasedCredits),
        realizedCreditRevenueUsd: r4(realizedCreditRevenueUsd),
        realizedSubscriptionRevenueUsd: r4(realizedSubRevenueUsd),
        totalRealizedRevenueUsd,
        aiApiExpensesUsd: r4(aiApiExpensesUsd),
        paymentGatewayFeesUsd: r4(paymentGatewayFeesUsd),
        hostingExpensesUsd: r2(hostingExpensesUsd),
        grossProfitUsd,
        netProfitUsd,
        activeSubscriptions: activeSubsRows.rowCount,
        totalUsers: Number(userCountRes.rows[0].cnt),
        totalAiRequests: Number(aiUsageAgg.rows[0].total_requests),
        totalTokensProcessed: Number(aiUsageAgg.rows[0].total_tokens),
      },
      dailyRevenue: dailySeriesRes.rows.map((d) => ({
        day: d.day,
        netCashUsd: r2(Number(d.cash_usd)),
      })),
      monthlyRevenue: monthlySeriesRes.rows.map((m) => ({
        month: m.month,
        netCashUsd: r2(Number(m.cash_usd)),
      })),
      providerExpenses: providerSpendRes.rows.map((p) => ({
        code: p.code,
        name: p.name,
        healthStatus: p.health_status,
        currentDaySpendUsd: Number(p.current_day_spend_usd || 0),
        dailyBudgetLimitUsd: Number(p.daily_budget_limit_usd || 0),
        currentMonthSpendUsd: Number(p.current_month_spend_usd || 0),
        monthlyBudgetLimitUsd: Number(p.monthly_budget_limit_usd || 0),
        providerReportedMonthUsd: Number(p.provider_reported_month_usd || 0),
        reconciliationDriftUsd: Number(p.reconciliation_drift_usd || 0),
      })),
    };
  }
}
