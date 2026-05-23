# Argentum Slice Validation Checklist

- Is the owning boundary explicit?
- Are canonical contracts free of provider-native or driver-native fields?
- Is state mutation confined to the owning module?
- Is the first validation narrow and executable?
- Are deferred decisions still deferred?
- Are required tests from the spec strategy covered or explicitly queued?
- Is observability preserved through canonical stream events or artifacts?