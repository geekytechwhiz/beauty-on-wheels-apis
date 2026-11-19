AWS_PROFILE=carish-new AWS_REGION=us-east-1 python3 <<'PY'
import json
import os
import subprocess
import sys
import time

profile = os.environ["AWS_PROFILE"]
region = os.environ.get("AWS_REGION", "us-east-1")

def aws(*args, check=True):
    cmd = ["aws", *args, "--profile", profile, "--region", region]
    result = subprocess.run(cmd, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "AWS CLI command failed")
    return result

try:
    account = aws(
        "sts", "get-caller-identity",
        "--query", "Account", "--output", "text"
    ).stdout.strip()

    summaries = json.loads(aws(
        "cloudformation", "list-stacks", "--output", "json"
    ).stdout).get("StackSummaries", [])

    active = [
        s for s in summaries
        if s.get("StackStatus") != "DELETE_COMPLETE"
        and s.get("StackStatus") != "DELETE_IN_PROGRESS"
    ]

    roots = []
    for summary in active:
        details = json.loads(aws(
            "cloudformation", "describe-stacks",
            "--stack-name", summary["StackId"], "--output", "json"
        ).stdout)["Stacks"][0]

        # Deleting a root stack also deletes its nested stacks.
        if not details.get("ParentId"):
            roots.append(details)

    print(f"AWS account: {account}")
    print(f"Region:      {region}")
    print("Root stacks to delete:")
    for stack in roots:
        print(f"  {stack['StackName']} [{stack['StackStatus']}]")

    if not roots:
        print("No root stacks found.")
        sys.exit(0)

    with open("/dev/tty", "r+") as tty:
        tty.write(
            f"\nType the AWS account ID ({account}) to confirm deletion: "
        )
        tty.flush()
        confirm = tty.readline().strip()

    if confirm != account:
        print("Confirmation did not match. No stacks were deleted.")
        sys.exit(1)

    pending = roots[:]
    while pending:
        next_pending = []
        deleted_or_started = False

        for stack in pending:
            stack_id = stack["StackId"]
            name = stack["StackName"]

            if stack.get("EnableTerminationProtection"):
                aws(
                    "cloudformation", "update-termination-protection",
                    "--no-enable-termination-protection",
                    "--stack-name", stack_id
                )

            print(f"\nDeleting {name}...")
            result = aws(
                "cloudformation", "delete-stack",
                "--stack-name", stack_id, check=False
            )

            if result.returncode != 0:
                print(f"Could not start deletion of {name}: {result.stderr.strip()}")
                next_pending.append(stack)
                continue

            deleted_or_started = True
            waiter = aws(
                "cloudformation", "wait", "stack-delete-complete",
                "--stack-name", stack_id, check=False
            )
            if waiter.returncode == 0:
                print(f"Deleted {name}.")
            else:
                print(f"Deletion of {name} did not complete; it may need investigation.")
                next_pending.append(stack)

        if next_pending and not deleted_or_started:
            print("\nSome stacks could not be deleted. Check their stack events and dependencies:")
            for stack in next_pending:
                print(f"  {stack['StackName']} ({stack['StackId']})")
            sys.exit(2)

        pending = next_pending

except Exception as exc:
    print(f"Stopped: {exc}", file=sys.stderr)
    sys.exit(1)
PY