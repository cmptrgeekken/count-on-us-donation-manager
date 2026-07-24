# Plain-language financial copy guide

Financial labels must tell the merchant what happened to the money. Internal
accounting terms may appear in technical documentation, but should not be the
primary interface wording.

## Preferred terms

| Avoid as the main label | Use in the interface | Help text |
|---|---|---|
| Available donation capacity | Profit available for giving | Profit left after product costs, fees, artist payments, and estimated taxes. |
| Requested donation / commitment | Amount assigned to causes | The amount produced by the cause percentages configured on products and artists. |
| Final donation pool | Amount set aside for causes | The amount the shop plans to pay to causes. It cannot be more than the profit available for giving. |
| Retained by shop | Profit kept by the shop | Profit that was not assigned to a cause. |
| Cause obligation | Amount owed to cause | The amount set aside for this cause from a closed reporting period. |
| Artist obligation | Amount owed to artist | Artist pay earned from sales in a closed reporting period. |
| Outstanding | Still to pay | Amount owed minus later changes and recorded payments. |
| Projection / projected commitment | Estimated from open period | This may change until the period closes. It cannot be paid yet. |
| Allocation adjustment | Later change | A refund, correction, or tax-related change recorded after the original amount was calculated. |
| Payment application | Where payment was used | The reporting-period amounts reduced by this payment, oldest first. |
| Capacity cap | Reduced to available profit | The cause amount was reduced because the shop did not have enough profit available for giving. |
| Routed contribution | Product profit assigned to this cause | Product profit multiplied by the cause percentage configured for the product or artist. |
| Reconciled | Totals match | The starting amount minus changes and payments equals the amount still to pay. |
| Reconciliation | Review how totals match | A breakdown showing how source amounts, changes, and payments produce the displayed total. |
| External settlement | Marketplace payment details | Money received and fees charged for an order paid outside Shopify Payments. |
| Tax true-up | Estimated tax correction | The difference between estimated tax and the actual tax later entered by the merchant. |

## Writing rules

1. Lead with the merchant action or outcome: “Causes still to pay,” not “Cause
   payables dashboard.”
2. Pair every calculated line with one short sentence explaining its inputs.
3. Use “estimated” for open-period amounts and state that they cannot be paid yet.
4. Use “amount set aside” for cause money and “amount earned” for artist money.
5. Use “change” in merchant-facing copy unless the specific kind—refund, tax
   correction, or manual correction—is known.
6. Avoid unexplained Track 1/Track 2 terminology. Describe the calculation first;
   technical track names may appear in an advanced view.
7. State sign behavior in words. For example, “Fees reduce the amount available”
   instead of relying on a minus sign alone.
8. Keep help text visible near unfamiliar financial lines. Do not require hover
   to understand a calculation.

## Calculation pattern

Use this order consistently:

```text
Profit after product costs
- Shopify fees
- Marketplace fees
- Artist payments
- Estimated taxes
+/- Estimated tax corrections
= Profit available for giving

Amount assigned to causes
capped at Profit available for giving
= Amount set aside for causes

Profit available for giving
- Amount set aside for causes
= Profit kept by the shop
```

## Site-wide implementation checklist

Apply this language consistently to:

- reporting overview, reporting-period details, close checks, and review lists;
- cause payment lists, cause details, payment forms, and payment history;
- artist payment lists, artist details, payment forms, and payment history;
- order-history calculation details and post-order changes;
- product and cart donation estimates;
- post-purchase summaries and emails;
- public transparency and receipt pages;
- CSV/PDF column labels and explanatory notes;
- imports, rebuild results, analytical comparison, and error messages;
- empty states, banners, confirmation dialogs, and accessibility labels.

Database fields, service types, and audit action names may keep precise internal
terminology. Translate them at the presentation boundary so merchants and public
visitors see the same plain-language model everywhere.
