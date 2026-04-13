interface Props {
  amount: number;
  payerName: string;
  onConfirm: () => void;
  onClose: () => void;
  submitting: boolean;
}

export default function PaymentSheet({ amount, onConfirm, onClose, submitting }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-border p-8 text-center">
      <h2 className="font-heading font-bold text-xl mb-2">Payment</h2>
      <p className="font-heading font-bold text-3xl text-primary mb-4">₹{amount}</p>
      <p className="text-muted text-sm mb-6">Payment sheet coming in Task 14</p>
      <div className="flex gap-3 justify-center">
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-full text-sm">Back</button>
        <button onClick={onConfirm} disabled={submitting} className="px-4 py-2 bg-primary text-white rounded-full text-sm">
          {submitting ? 'Submitting...' : 'Confirm Payment'}
        </button>
      </div>
    </div>
  );
}
