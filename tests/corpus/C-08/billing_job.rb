# frozen_string_literal: true

module Aice
  module Billing
    class BillingJob
      MAX_RETRIES = 3

      def initialize(gateway:, logger:)
        @gateway = gateway
        @logger = logger
      end

      def run(invoice_id:, amount_cents:)
        raise ArgumentError, "invoice_id required" if invoice_id.to_s.strip.empty?
        raise ArgumentError, "amount_cents must be positive" if amount_cents <= 0

        attempt = 0
        begin
          attempt += 1
          receipt = @gateway.charge(invoice_id: invoice_id, amount_cents: amount_cents)
          @logger.info("charged invoice=#{invoice_id} receipt=#{receipt[:id]}")
          { status: :settled, receipt_id: receipt[:id], attempts: attempt }
        rescue StandardError => err
          if attempt < MAX_RETRIES
            @logger.warn("retry invoice=#{invoice_id} attempt=#{attempt} err=#{err.message}")
            retry
          end
          @logger.error("failed invoice=#{invoice_id} attempts=#{attempt} err=#{err.message}")
          { status: :failed, error: err.message, attempts: attempt }
        end
      end

      def run_batch(invoices:)
        raise ArgumentError, "invoices must be an Array" unless invoices.is_a?(Array)

        results = { settled: [], failed: [] }
        invoices.each do |entry|
          outcome = run(invoice_id: entry[:invoice_id], amount_cents: entry[:amount_cents])
          if outcome[:status] == :settled
            results[:settled] << outcome.merge(invoice_id: entry[:invoice_id])
          else
            results[:failed] << outcome.merge(invoice_id: entry[:invoice_id])
          end
        end
        results
      end

      def estimate_processing_fee(amount_cents:, fee_bps: 290, fixed_cents: 30)
        return 0 if amount_cents <= 0

        ((amount_cents * fee_bps + 5000) / 10_000) + fixed_cents
      end

      def validate_currency!(currency_code)
        allowed = %w[USD EUR GBP]
        return currency_code if allowed.include?(currency_code)

        raise ArgumentError, "unsupported currency=#{currency_code}"
      end
    end
  end
end
