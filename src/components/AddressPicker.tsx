import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getProvinces, getDistricts, getCities } from '@/lib/pkAddress';
import { composeFullAddress } from '@/lib/customers';
import { CustomerProfile } from '@/lib/types';

type AddressFields = Partial<Pick<CustomerProfile,
  'province' | 'district' | 'city' | 'area' | 'society' |
  'street' | 'streetNumber' | 'houseNumber' | 'fullAddress'
>>;

interface Props {
  value: AddressFields;
  onChange: (v: AddressFields) => void;
  compact?: boolean;
}

/** Cascading PK address picker with always-visible Full Address textarea. */
export default function AddressPicker({ value, onChange, compact }: Props) {
  const provinces = getProvinces();
  const districts = value.province ? getDistricts(value.province) : [];
  const cities = value.province && value.district ? getCities(value.province, value.district) : [];

  // Auto-compose full address whenever structured fields change (only if user hasn't edited it manually)
  const [manualFull, setManualFull] = useState(!!value.fullAddress);
  useEffect(() => {
    if (manualFull) return;
    const composed = composeFullAddress(value);
    if (composed && composed !== value.fullAddress) {
      onChange({ ...value, fullAddress: composed });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.province, value.district, value.city, value.area, value.society, value.street, value.streetNumber, value.houseNumber]);

  const set = (patch: AddressFields) => onChange({ ...value, ...patch });

  const grid = compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3';

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${grid}`}>
        <div>
          <Label className="text-xs">Province</Label>
          <Select value={value.province || ''} onValueChange={(v) => set({ province: v, district: undefined, city: undefined })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select province" /></SelectTrigger>
            <SelectContent>{provinces.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">District</Label>
          <Select value={value.district || ''} onValueChange={(v) => set({ district: v, city: undefined })} disabled={!value.province}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select district" /></SelectTrigger>
            <SelectContent>{districts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">City</Label>
          <Select value={value.city || ''} onValueChange={(v) => set({ city: v })} disabled={!value.district}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Select city" /></SelectTrigger>
            <SelectContent>{cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Area / Colony</Label>
          <Input className="h-9" value={value.area || ''} onChange={e => set({ area: e.target.value })} placeholder="e.g. Model Town" />
        </div>
        <div>
          <Label className="text-xs">Housing Society</Label>
          <Input className="h-9" value={value.society || ''} onChange={e => set({ society: e.target.value })} placeholder="e.g. DHA Phase 5" />
        </div>
        <div>
          <Label className="text-xs">Street / Road</Label>
          <Input className="h-9" value={value.street || ''} onChange={e => set({ street: e.target.value })} placeholder="e.g. Commercial Broadway" />
        </div>
        <div>
          <Label className="text-xs">Street #</Label>
          <Input className="h-9" value={value.streetNumber || ''} onChange={e => set({ streetNumber: e.target.value })} placeholder="e.g. 12" />
        </div>
        <div>
          <Label className="text-xs">House #</Label>
          <Input className="h-9" value={value.houseNumber || ''} onChange={e => set({ houseNumber: e.target.value })} placeholder="e.g. 248-B" />
        </div>
      </div>
      <div>
        <Label className="text-xs">Full Address (free text)</Label>
        <Textarea
          rows={2}
          value={value.fullAddress || ''}
          onChange={e => { setManualFull(true); set({ fullAddress: e.target.value }); }}
          placeholder="Manually type / paste the complete address"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Auto-fills from structured fields. Edit here to override.
        </p>
      </div>
    </div>
  );
}
